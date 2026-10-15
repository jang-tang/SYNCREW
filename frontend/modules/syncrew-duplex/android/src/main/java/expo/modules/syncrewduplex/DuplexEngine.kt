package expo.modules.syncrewduplex

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

/**
 * 캡처(AudioRecord)와 재생(AudioTrack)을 동시에 돌린다. 스레드: 캡처 1, 재생 쓰기 1.
 * - 캡처: frameMs 마다 PCM16 조각을 onFrame(base64) 으로 보낸다
 * - 재생: enqueue 로 받은 조각을 24kHz 로 맞춰 큐에 넣고 쓰기 스레드가 이어서 쓴다.
 *   다 재생되면(쓴 양 ≤ 재생 위치) onPlayback(false). 비어 있다가 새로 쓸 때 120ms 무음을 먼저 쓴다(지터 버퍼)
 */
class DuplexEngine(
  context: Context,
  private val emit: (String, Map<String, Any?>) -> Unit,
  onRoute: (String, String?) -> Unit,
) {
  private sealed class PlayItem {
    class Chunk(val streamId: String, val samples: ShortArray) : PlayItem()
    class End(val streamId: String) : PlayItem()
  }

  private val route = CallRoute(context, onRoute)
  private val queue = LinkedBlockingQueue<PlayItem>()
  private val flushRequested = AtomicBoolean(false)

  @Volatile private var running = false
  @Volatile private var currentStream: String? = null
  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private val effects = mutableListOf<AudioEffect>()
  private var captureThread: Thread? = null
  private var playThread: Thread? = null

  @SuppressLint("MissingPermission") // 모듈의 start 가 RECORD_AUDIO 를 확인한 뒤 부른다
  @Synchronized
  fun start(sampleRate: Int, frameMs: Int, echoCancellation: Boolean) {
    if (running) return
    route.enter()
    val frameSamples = max(1, sampleRate * frameMs / 1000)
    try {
      val minRecord = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minRecord > 0) { "녹음 버퍼 크기를 알 수 없습니다 ($minRecord)" }
      val rec = AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        max(minRecord, frameSamples * 2 * 4),
      )
      if (rec.state != AudioRecord.STATE_INITIALIZED) {
        rec.release()
        error("마이크를 열 수 없습니다")
      }
      attachEffects(rec.audioSessionId, echoCancellation)

      val minPlay = AudioTrack.getMinBufferSize(PLAY_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val trk = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setSampleRate(PLAY_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build(),
        )
        .setTransferMode(AudioTrack.MODE_STREAM)
        .setBufferSizeInBytes(max(minPlay, PLAY_RATE * 2 / 5)) // 약 200ms
        .build()

      rec.startRecording()
      trk.play()
      record = rec
      track = trk
      queue.clear()
      flushRequested.set(false)
      running = true
      captureThread = Thread({ captureLoop(rec, frameSamples) }, "syncrew-duplex-capture").apply {
        priority = Thread.MAX_PRIORITY
        start()
      }
      playThread = Thread({ playLoop(trk) }, "syncrew-duplex-play").apply { start() }
    } catch (e: Exception) {
      releaseAll()
      route.exit()
      throw e
    }
  }

  @Synchronized
  fun stop() {
    running = false
    runCatching { record?.stop() }
    captureThread?.join(500)
    queue.clear()
    runCatching {
      track?.pause()
      track?.flush()
    }
    playThread?.join(500)
    captureThread = null
    playThread = null
    releaseAll()
    currentStream?.let {
      currentStream = null
      emit("onPlayback", mapOf("streamId" to it, "playing" to false))
    }
    route.exit()
  }

  fun enqueue(streamId: String, pcmBase64: String, sampleRate: Int) {
    if (!running) return
    val bytes = runCatching { Base64.decode(pcmBase64, Base64.DEFAULT) }.getOrNull() ?: return
    if (bytes.size < 2) return
    val samples = ShortArray(bytes.size / 2)
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples)
    queue.offer(PlayItem.Chunk(streamId, resample(samples, sampleRate, PLAY_RATE)))
  }

  fun endStream(streamId: String) {
    if (running) queue.offer(PlayItem.End(streamId))
  }

  fun stopPlayback() {
    if (!running) return
    queue.clear()
    flushRequested.set(true)
  }

  // ─── 캡처 ─────────────────────────────────────────

  // 오디오 장치에서 읽고 쓸 때 블로킹 호출을 쓰지 않는다 (논블로킹 + 10ms 쉬기).
  // 블로킹 read·write 가 오래 막히면(장치가 데이터를 안 줄 때) 그동안 런타임의 스레드 일시 정지(GC 등)가 끝나지 않아
  // JS 가 Java 모듈을 부르는 순간 앱 전체가 멈췄다 (2026-10-15 에뮬레이터: 통화 모드 입력이 60초 막혀 JS 가 60초 멈추고 소켓이 끊김).
  // 배열(short[]) 대신 직접 버퍼(allocateDirect)를 쓰는 것도 같은 이유 (배열 판은 JNI critical 로 GC 를 막는다).
  private fun captureLoop(rec: AudioRecord, frameSamples: Int) {
    val frameBytes = frameSamples * 2
    val direct = ByteBuffer.allocateDirect(frameBytes).order(ByteOrder.LITTLE_ENDIAN)
    val frame = ByteArray(frameBytes)
    while (running) {
      var filled = 0
      while (filled < frameBytes && running) {
        // read(ByteBuffer) 는 버퍼 위치와 상관없이 앞에서부터 채운다 → 받은 만큼 frame 에 이어 붙인다
        val read = rec.read(direct, frameBytes - filled, AudioRecord.READ_NON_BLOCKING)
        if (read < 0) {
          if (running) emit("onError", mapOf("code" to "record_failed", "message" to "AudioRecord.read $read"))
          return
        }
        if (read == 0) {
          Thread.sleep(IDLE_SLEEP_MS)
          continue
        }
        direct.position(0)
        direct.get(frame, filled, read)
        direct.clear()
        filled += read
      }
      if (filled < frameBytes) return
      emit(
        "onFrame",
        mapOf(
          "pcm" to Base64.encodeToString(frame, Base64.NO_WRAP),
          "timestamp" to System.currentTimeMillis().toDouble(),
        ),
      )
    }
  }

  // ─── 재생 ─────────────────────────────────────────

  private fun playLoop(trk: AudioTrack) {
    var written = 0L
    var headBase = head(trk)
    val silence = ShortArray(PLAY_RATE * JITTER_MS / 1000)

    fun drained() = head(trk) - headBase >= written

    var direct = ByteBuffer.allocateDirect(PLAY_RATE / 5 * 2).order(ByteOrder.LITTLE_ENDIAN) // 200ms, 모자라면 늘린다

    fun write(samples: ShortArray) {
      val bytes = samples.size * 2
      if (direct.capacity() < bytes) direct = ByteBuffer.allocateDirect(bytes).order(ByteOrder.LITTLE_ENDIAN)
      direct.clear()
      direct.asShortBuffer().put(samples)
      direct.limit(bytes)
      while (direct.hasRemaining() && running && !flushRequested.get()) {
        // 쓴 만큼 position 이 앞으로 간다. 버퍼가 차 있으면 0 → 잠깐 쉬고 다시
        val count = trk.write(direct, direct.remaining(), AudioTrack.WRITE_NON_BLOCKING)
        if (count < 0) {
          emit("onError", mapOf("code" to "playback_failed", "message" to "AudioTrack.write $count"))
          break
        }
        if (count == 0) Thread.sleep(IDLE_SLEEP_MS)
      }
      written += direct.position() / 2
    }

    fun finishCurrent() {
      currentStream?.let {
        currentStream = null
        emit("onPlayback", mapOf("streamId" to it, "playing" to false))
      }
    }

    while (running) {
      if (flushRequested.getAndSet(false)) {
        runCatching {
          trk.pause()
          trk.flush()
          trk.play()
        }
        written = 0
        headBase = head(trk)
        finishCurrent()
      }
      val item = queue.poll(20, TimeUnit.MILLISECONDS)
      if (item == null) {
        if (currentStream != null && drained()) finishCurrent()
        continue
      }
      if (item is PlayItem.Chunk) {
        if (drained()) write(silence)
        if (currentStream != item.streamId) {
          currentStream = item.streamId
          emit("onPlayback", mapOf("streamId" to item.streamId, "playing" to true))
        }
        write(item.samples)
      }
      // End: 따로 할 일 없음 — 다 재생되면 위에서 멈춤을 알린다
    }
  }

  /** 재생된 표본 수 (playbackHeadPosition 은 부호 없는 32비트) */
  private fun head(trk: AudioTrack): Long = trk.playbackHeadPosition.toLong() and 0xffffffffL

  // ─── 정리 ─────────────────────────────────────────

  private fun attachEffects(sessionId: Int, echoCancellation: Boolean) {
    if (echoCancellation && AcousticEchoCanceler.isAvailable()) {
      AcousticEchoCanceler.create(sessionId)?.let {
        it.enabled = true
        effects.add(it)
      }
    }
    if (NoiseSuppressor.isAvailable()) {
      NoiseSuppressor.create(sessionId)?.let {
        it.enabled = true
        effects.add(it)
      }
    }
    if (AutomaticGainControl.isAvailable()) {
      AutomaticGainControl.create(sessionId)?.let {
        it.enabled = true
        effects.add(it)
      }
    }
  }

  private fun releaseAll() {
    effects.forEach { runCatching { it.release() } }
    effects.clear()
    record?.let { runCatching { it.release() } }
    track?.let { runCatching { it.release() } }
    record = null
    track = null
  }

  companion object {
    /** 서버 통역 음성 표본율 (gpt-realtime 출력 24kHz). 다른 표본율은 선형 보간으로 맞춘다 */
    const val PLAY_RATE = 24_000
    const val JITTER_MS = 120
    const val IDLE_SLEEP_MS = 10L

    fun resample(input: ShortArray, from: Int, to: Int): ShortArray {
      if (from == to || from <= 0 || input.isEmpty()) return input
      val outLength = (input.size.toLong() * to / from).toInt()
      val output = ShortArray(outLength)
      val step = from.toDouble() / to
      for (i in 0 until outLength) {
        val position = i * step
        val index = position.toInt()
        val fraction = position - index
        val a = input[min(index, input.size - 1)].toInt()
        val b = input[min(index + 1, input.size - 1)].toInt()
        output[i] = (a + (b - a) * fraction).toInt().toShort()
      }
      return output
    }
  }
}
