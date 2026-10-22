package expo.modules.syncrewduplex

import android.media.AudioAttributes
import android.media.MediaPlayer

/**
 * 발화 단위 통화의 통역 음성 재생 (통화 용도).
 * expo-audio 재생기는 미디어 용도(AudioAttributes.DEFAULT)로 고정이라, 통화 경로(통신 모드 + 블루투스 SCO)에서는 소리가
 * 멈춰 있는 A2DP 로 나가 헤드셋에서 들리지 않았다 (2026-10-23 Note 9 + WH-1000XM6). 여기서는 USAGE_VOICE_COMMUNICATION 으로
 * 재생해 CallRoute 가 고른 장치(헤드셋 SCO·유선·스피커)로 나가게 한다.
 * 한 번에 하나만 재생한다. 새로 재생하거나 stop() 하면 앞의 것은 끝난 것으로(false 가 아닌 완료로) 알린다.
 */
class CallPlayer {
  private var player: MediaPlayer? = null
  private var onDone: ((Exception?) -> Unit)? = null

  @Synchronized
  fun play(url: String, done: (Exception?) -> Unit) {
    stop()
    onDone = done
    val media = MediaPlayer()
    player = media
    try {
      media.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      media.setDataSource(url)
      media.setOnPreparedListener { it.start() }
      media.setOnCompletionListener { finish(media, null) }
      media.setOnErrorListener { _, what, extra ->
        finish(media, IllegalStateException("재생 오류 ($what/$extra)"))
        true
      }
      media.prepareAsync()
    } catch (e: Exception) {
      finish(media, e)
    }
  }

  @Synchronized
  fun stop() {
    val media = player ?: return
    finish(media, null)
  }

  @Synchronized
  private fun finish(media: MediaPlayer, error: Exception?) {
    if (player !== media) return
    player = null
    val done = onDone
    onDone = null
    try {
      media.reset()
      media.release()
    } catch (_: Exception) {
    }
    done?.invoke(error)
  }
}
