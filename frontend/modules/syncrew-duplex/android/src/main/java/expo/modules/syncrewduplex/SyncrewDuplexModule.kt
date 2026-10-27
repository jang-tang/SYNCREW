package expo.modules.syncrewduplex

import android.Manifest
import android.content.pm.PackageManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// SYNCREW 이중(동시 녹음·재생) 오디오 — Android (docs/streaming-plan.md S3)
//   경로: 통신 모드(MODE_IN_COMMUNICATION) + 통신 장치 선택 (블루투스 헤드셋 SCO > 유선 > 스피커) — CallRoute.kt
//   캡처: AudioRecord(VOICE_COMMUNICATION, 16kHz mono PCM16) + 에코 제거·잡음 억제·자동 음량 → 100ms 조각 — DuplexEngine.kt
//   재생: AudioTrack(USAGE_VOICE_COMMUNICATION, 24kHz, 스트리밍) 쓰기 스레드 + 큐, 비어 있다가 시작할 때 120ms 무음
//   발화 단위 통화(expo-audio 녹음)는 enterCallRoute/exitCallRoute 로 경로만 잡는다 (2026-10-14 실기기: 헤드셋 마이크가 무음이던 문제)
//   그때 통역 음성은 playInCall 로 통화 용도 재생 — CallPlayer.kt (2026-10-23 실기기: expo-audio 재생이 헤드셋에서 안 들리던 문제)

class SyncrewDuplexModule : Module() {
  private var duplex: DuplexEngine? = null
  private var callRoute: CallRoute? = null
  private val callPlayer = CallPlayer()
  /** 통화 중 음량 버튼으로 상대 바꾸기 (C1) — VolumeKeys.kt */
  private var volumeKeys: VolumeKeys? = null
  /**
   * 앱이 음량 버튼 지켜보기를 원하는지. 앱이 뒤로 가면 잠시 멈추고 앞으로 오면 다시 켠다 —
   * 10-26 Note 9: 다른 앱(넷플릭스)이 앞에 있는데도 헤드셋 음량을 계속 되돌려 그 앱 음량을 못 바꿨다
   */
  private var volumeKeysWanted = false

  private fun emitRoute(route: String, name: String?) {
    sendEvent("onRoute", mapOf("route" to route, "name" to name))
  }

  override fun definition() = ModuleDefinition {
    Name("SyncrewDuplex")

    Events("onFrame", "onRoute", "onPlayback", "onError", "onVolumeKey")

    AsyncFunction("start") { sampleRate: Int, frameMs: Int, echoCancellation: Boolean, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("start_failed", "앱 컨텍스트가 없습니다.", null)
        return@AsyncFunction
      }
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("permission", "마이크 권한이 없습니다.", null)
        return@AsyncFunction
      }
      try {
        // 발화 단위 방식이 잡아 둔 경로가 있으면 넘겨받는다 (이중 오디오가 직접 관리)
        callRoute?.exit()
        callRoute = null
        val engine = duplex ?: DuplexEngine(context, { name, body -> sendEvent(name, body) }, ::emitRoute).also { duplex = it }
        // 통화 오디오로 바뀌면 음량이 저절로 바뀔 수 있다 → 음량 버튼 판정을 잠시 멈춘다
        volumeKeys?.settle()
        engine.start(sampleRate, frameMs, echoCancellation)
        volumeKeys?.settle()
        promise.resolve(null)
      } catch (e: Exception) {
        duplex?.stop()
        promise.reject("start_failed", e.message ?: e.toString(), e)
      }
    }

    AsyncFunction("stop") {
      volumeKeys?.settle()
      duplex?.stop()
      volumeKeys?.settle()
    }

    Function("enqueue") { streamId: String, pcmBase64: String, sampleRate: Int ->
      duplex?.enqueue(streamId, pcmBase64, sampleRate)
    }

    Function("endStream") { streamId: String ->
      duplex?.endStream(streamId)
    }

    Function("stopPlayback") {
      duplex?.stopPlayback()
    }

    AsyncFunction("enterCallRoute") {
      val context = appContext.reactContext ?: throw IllegalStateException("앱 컨텍스트가 없습니다.")
      val route = callRoute ?: CallRoute(context, ::emitRoute).also { callRoute = it }
      volumeKeys?.settle()
      route.enter()
      volumeKeys?.settle()
      val (kind, name) = route.current()
      mapOf("route" to kind, "name" to name)
    }

    AsyncFunction("exitCallRoute") {
      callPlayer.stop()
      volumeKeys?.settle()
      callRoute?.exit()
      callRoute = null
    }

    // 통화 경로(enterCallRoute)가 잡혀 있을 때만 통화 용도로 재생하고 끝나면 true. 경로가 없으면 바로 false (JS 가 expo-audio 로 재생)
    AsyncFunction("playInCall") { url: String, promise: Promise ->
      val route = callRoute
      if (route == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      route.apply() // 재생 직전에 통신 모드·장치를 다시 맞춘다 (다른 코드가 모드를 풀었을 수 있다)
      callPlayer.play(url) { error ->
        if (error == null) promise.resolve(true) else promise.reject("play_failed", error.message ?: error.toString(), error)
      }
    }

    Function("stopInCall") {
      callPlayer.stop()
    }

    // 음량 버튼 지켜보기 (C1): 누를 때마다 onVolumeKey. 휴대폰 버튼은 가로채고 헤드셋 버튼은 곧바로 되돌린다. 한 번 누름은 JS 가 stepVolume 으로
    Function("startVolumeKeys") {
      volumeKeysWanted = true
      appContext.reactContext?.let { context ->
        val keys = volumeKeys ?: VolumeKeys(context, { appContext.currentActivity }) { direction ->
          sendEvent("onVolumeKey", mapOf("direction" to direction))
        }.also { volumeKeys = it }
        keys.start()
      }
      Unit
    }

    Function("stopVolumeKeys") {
      volumeKeysWanted = false
      volumeKeys?.stop()
    }

    OnActivityEntersBackground {
      volumeKeys?.stop()
    }

    OnActivityEntersForeground {
      if (volumeKeysWanted) volumeKeys?.start()
    }

    Function("stepVolume") { direction: String ->
      volumeKeys?.step(direction)
    }

    // Android: 누름마다 이미 막거나(휴대폰 버튼) 되돌렸으므로(헤드셋) 두 번 누름 뒤 되돌릴 것이 없다 (iOS 와 같은 계약)
    Function("restoreVolume") {}

    OnDestroy {
      volumeKeys?.stop()
      volumeKeys = null
      callPlayer.stop()
      duplex?.stop()
      duplex = null
      callRoute?.exit()
      callRoute = null
    }
  }
}
