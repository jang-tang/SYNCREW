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

class SyncrewDuplexModule : Module() {
  private var duplex: DuplexEngine? = null
  private var callRoute: CallRoute? = null

  private fun emitRoute(route: String, name: String?) {
    sendEvent("onRoute", mapOf("route" to route, "name" to name))
  }

  override fun definition() = ModuleDefinition {
    Name("SyncrewDuplex")

    Events("onFrame", "onRoute", "onPlayback", "onError")

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
        engine.start(sampleRate, frameMs, echoCancellation)
        promise.resolve(null)
      } catch (e: Exception) {
        duplex?.stop()
        promise.reject("start_failed", e.message ?: e.toString(), e)
      }
    }

    AsyncFunction("stop") {
      duplex?.stop()
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
      route.enter()
      val (kind, name) = route.current()
      mapOf("route" to kind, "name" to name)
    }

    AsyncFunction("exitCallRoute") {
      callRoute?.exit()
      callRoute = null
    }

    OnDestroy {
      duplex?.stop()
      duplex = null
      callRoute?.exit()
      callRoute = null
    }
  }
}
