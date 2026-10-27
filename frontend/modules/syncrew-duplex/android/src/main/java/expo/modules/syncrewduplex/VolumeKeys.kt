package expo.modules.syncrewduplex

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.Window

// 통화 중 음량 버튼으로 상대 바꾸기 (C1, docs/implementation-plan.md C1 3단계) — Android
//   휴대폰 버튼: 화면의 키 입력(Window.Callback)을 가로채 시스템이 음량을 바꾸지 못하게 하고 누름만 알린다 → 음량이 순간도 안 바뀐다
//   헤드셋 버튼: 헤드셋이 음량을 바꾸고 휴대폰에는 결과만 온다(VOLUME_CHANGED_ACTION) → 누름으로 알리고 곧바로 앞 값으로 되돌린다
//     (아주 짧게 바뀌었다 돌아오는 것은 괜찮다 — 사용자 10-26)
//   한 번 누름의 음량 변경은 JS 가 판정(0.45초) 뒤 step() 으로 한다
//   음량이 끝(최소·최대)이면 그쪽 헤드셋 누름이 안 올 수 있다 (iOS 는 10-26 확인) → 지켜보는 동안 통화·미디어 음량을
//   최소+1 ~ 최대-1 안에 둔다 (사용자 10-26). 한 번 누름의 음량 변경(step)도 이 안에서만

class VolumeKeys(
  private val context: Context,
  private val activity: () -> Activity?,
  private val onPress: (String) -> Unit,
) {
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var window: Window? = null
  private var interceptor: Interceptor? = null
  private var receiver: BroadcastReceiver? = null

  /** 되돌린 값이 다시 방송으로 오는 것을 누름으로 세지 않는다 (같은 값·짧은 시간 안) */
  private var revertValue = -1
  private var revertUntil = 0L
  /** 한 번 누름이 같은 변경을 스트림 별칭(통화·블루투스 SCO)으로 두 번 방송하는 것을 하나로 */
  private var lastPressAt = 0L
  /** step() 으로 바꾼 음량의 방송은 세지 않는다 */
  private var ignoreUntil = 0L

  /** 휴대폰 버튼 입력을 가로채는 창 콜백. 나머지는 원래 콜백에 그대로 넘긴다 */
  private inner class Interceptor(val base: Window.Callback) : Window.Callback by base {
    var enabled = true

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      val direction = when (event.keyCode) {
        KeyEvent.KEYCODE_VOLUME_UP -> "up"
        KeyEvent.KEYCODE_VOLUME_DOWN -> "down"
        else -> null
      }
      if (!enabled || direction == null) return base.dispatchKeyEvent(event)
      // 누르고 있을 때의 반복은 세지 않는다. 떼는 입력까지 먹어야 시스템이 음량을 바꾸지 않는다
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        Log.d(TAG, "phone key $direction")
        onPress(direction)
      }
      return true
    }
  }

  fun start() {
    val activity = activity() ?: run {
      Log.w(TAG, "start: activity 없음")
      return
    }
    activity.runOnUiThread {
      if (interceptor?.enabled == true) return@runOnUiThread
      val win = activity.window
      val current = win.callback
      if (current != null) {
        val wrapped = Interceptor(current)
        win.callback = wrapped
        window = win
        interceptor = wrapped
      }
      registerReceiver()
      keepInRange(AudioManager.STREAM_VOICE_CALL)
      keepInRange(AudioManager.STREAM_MUSIC)
      @Suppress("DEPRECATION")
      if (audio.isBluetoothScoOn) keepInRange(STREAM_BLUETOOTH_SCO)
      Log.d(TAG, "start")
    }
  }

  fun stop() {
    activity()?.runOnUiThread { stopNow() } ?: stopNow()
  }

  private fun stopNow() {
    interceptor?.let { wrapped ->
      wrapped.enabled = false
      // 그 사이 다른 코드가 콜백을 또 감쌌으면 건드리지 않는다 (꺼 둔 채 그대로 넘기기만 한다)
      if (window?.callback === wrapped) window?.callback = wrapped.base
    }
    interceptor = null
    window = null
    receiver?.let { runCatching { context.unregisterReceiver(it) } }
    receiver = null
    Log.d(TAG, "stop")
  }

  /**
   * 통화 오디오(통신 모드·블루투스 SCO)가 켜지거나 꺼질 때는 음량이 저절로 바뀔 수 있다 → 잠시 누름으로 세지 않는다.
   * 10-26 iPhone 에서 통화가 연결되자마자 음량 변화가 "두 번 누름" 으로 잡혀 상대가 넘어갔다 → Android 도 같은 보호
   */
  fun settle() {
    ignoreUntil = SystemClock.uptimeMillis() + SETTLE_MS
  }

  /** 한 번 누름: 지금 쓰는 스트림(통화 중이면 통화, 아니면 미디어)을 한 칸 바꾸고 음량 표시를 띄운다. 끝에서 한 칸 안쪽까지만 */
  fun step(direction: String) {
    @Suppress("DEPRECATION")
    val stream = when {
      audio.mode != AudioManager.MODE_IN_COMMUNICATION -> AudioManager.STREAM_MUSIC
      audio.isBluetoothScoOn -> STREAM_BLUETOOTH_SCO // 통화 중 블루투스 헤드셋은 이 스트림 음량으로 들린다
      else -> AudioManager.STREAM_VOICE_CALL
    }
    runCatching {
      val (low, high) = range(stream)
      val current = audio.getStreamVolume(stream)
      val target = (current + if (direction == "up") 1 else -1).coerceIn(low, high)
      ignoreUntil = SystemClock.uptimeMillis() + SELF_CHANGE_MS
      audio.setStreamVolume(stream, target, AudioManager.FLAG_SHOW_UI)
    }.onFailure { Log.w(TAG, "step 실패 stream=$stream", it) }
  }

  /** 끝에 닿으면 그쪽 누름을 알 수 없으므로 최소+1 ~ 최대-1 */
  private fun range(stream: Int): Pair<Int, Int> {
    // 블루투스 SCO(6)는 공개 스트림이 아니라 getStreamMinVolume 이 IllegalArgumentException 을 던진다
    // (10-26 Note 9 + WH-1000XM6 통화 모드에서 앱이 꺼졌다) → 최소는 0 으로 본다
    val min = if (Build.VERSION.SDK_INT >= 28) runCatching { audio.getStreamMinVolume(stream) }.getOrDefault(0) else 0
    val max = audio.getStreamMaxVolume(stream)
    return if (max - min >= 2) Pair(min + 1, max - 1) else Pair(min, max)
  }

  private fun keepInRange(stream: Int) {
    runCatching {
      val (low, high) = range(stream)
      val current = audio.getStreamVolume(stream)
      val target = current.coerceIn(low, high)
      if (target == current) return
      Log.d(TAG, "keep in range stream=$stream $current -> $target")
      ignoreUntil = SystemClock.uptimeMillis() + SELF_CHANGE_MS
      audio.setStreamVolume(stream, target, 0)
    }.onFailure { Log.w(TAG, "keepInRange 실패 stream=$stream", it) }
  }

  private fun registerReceiver() {
    if (receiver != null) return
    val r = object : BroadcastReceiver() {
      // 방송 처리 중 예외는 앱 전체를 끈다 → 어떤 경우에도 밖으로 던지지 않는다
      override fun onReceive(c: Context, intent: Intent) {
        runCatching { handle(intent) }.onFailure { Log.w(TAG, "volume 방송 처리 실패", it) }
      }

      private fun handle(intent: Intent) {
        val stream = intent.getIntExtra(EXTRA_STREAM_TYPE, -1)
        val value = intent.getIntExtra(EXTRA_VALUE, -1)
        val prev = intent.getIntExtra(EXTRA_PREV_VALUE, -1)
        if (stream !in WATCHED_STREAMS || value < 0 || prev < 0 || value == prev) return
        // 버튼 한 번은 한 칸(빠르면 두 칸)씩 바뀐다 — 더 크게 바뀌면 장치·모드 전환이다
        if (kotlin.math.abs(value - prev) > 2) {
          Log.d(TAG, "volume jump (not a press) stream=$stream $prev -> $value")
          return
        }
        val now = SystemClock.uptimeMillis()
        if (now < ignoreUntil) return
        if (value == revertValue && now < revertUntil) return
        if (now - lastPressAt < ALIAS_MS) return
        val direction = if (value > prev) "up" else "down"
        Log.d(TAG, "headset key $direction stream=$stream $prev -> $value")
        lastPressAt = now
        revertValue = prev
        revertUntil = now + REVERT_MS
        val (low, high) = range(stream)
        val back = prev.coerceIn(low, high)
        revertValue = back
        runCatching { audio.setStreamVolume(stream, back, 0) }
        onPress(direction)
      }
    }
    val filter = IntentFilter(VOLUME_CHANGED_ACTION)
    // 시스템 방송만 받으면 되므로 다른 앱에는 열지 않는다 (Android 13+ 는 표시가 필요)
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(r, filter)
    }
    receiver = r
  }

  companion object {
    private const val TAG = "SyncrewVolumeKeys"
    // AudioManager 의 숨은 상수 (공개 API 아님, 오래 그대로인 이름)
    private const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
    private const val EXTRA_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
    private const val EXTRA_VALUE = "android.media.EXTRA_VOLUME_STREAM_VALUE"
    private const val EXTRA_PREV_VALUE = "android.media.EXTRA_PREV_VOLUME_STREAM_VALUE"
    /** AudioManager.STREAM_BLUETOOTH_SCO (숨은 상수) */
    private const val STREAM_BLUETOOTH_SCO = 6
    /** 통화(0)·미디어(3)·블루투스 SCO(6) */
    private val WATCHED_STREAMS = setOf(AudioManager.STREAM_VOICE_CALL, AudioManager.STREAM_MUSIC, STREAM_BLUETOOTH_SCO)
    private const val ALIAS_MS = 80L
    private const val REVERT_MS = 500L
    private const val SELF_CHANGE_MS = 300L
    private const val SETTLE_MS = 1000L
  }
}
