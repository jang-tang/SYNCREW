package expo.modules.syncrewduplex

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executor

/**
 * 통화용 오디오 경로: 통신 모드로 바꾸고 통신 장치를 고른다 (블루투스 헤드셋 > 유선 헤드셋 > 스피커).
 * - Android 12(API 31)+: setCommunicationDevice — 블루투스 헤드셋이면 SCO(통화 품질 마이크·스피커)가 열린다
 * - 그 이하: startBluetoothSco / 스피커폰
 * 2026-10-14 Galaxy S22 + Buds2 실기기: 입력만 헤드셋으로 고르고 SCO 를 열지 않으면 녹음이 완전 무음이었다.
 * 장치가 붙거나 빠지면 다시 고르고, 바뀐 경로를 onRoute 로 알린다.
 */
class CallRoute(context: Context, private val onRoute: (String, String?) -> Unit) {
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val handler = Handler(Looper.getMainLooper())
  private val mainExecutor = Executor { handler.post(it) }
  private var active = false
  private var previousMode = AudioManager.MODE_NORMAL
  /** Android 11 이하: startBluetoothSco 를 이미 불렀는지. 시스템이 호출 횟수를 세므로 한 번만 부르고 한 번만 끈다
   *  (2026-10-23 Note 9(Android 10): 시작 때 2번 불려 멈춘 뒤에도 SCO 가 켜진 채 남았다 — 음악까지 통화 음질로) */
  private var scoRequested = false
  /** AudioManager.OnCommunicationDeviceChangedListener (API 31+, 옛 기기에서 클래스를 읽지 않도록 Any 로 둔다) */
  private var communicationListener: Any? = null

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = apply()
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = apply()
  }

  @Synchronized
  fun enter() {
    if (active) {
      apply()
      return
    }
    active = true
    previousMode = audioManager.mode
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val listener = AudioManager.OnCommunicationDeviceChangedListener { emitCurrent() }
      audioManager.addOnCommunicationDeviceChangedListener(mainExecutor, listener)
      communicationListener = listener
    }
    // 등록하면 지금 있는 장치로 onAudioDevicesAdded 가 한 번 불린다 → apply
    audioManager.registerAudioDeviceCallback(deviceCallback, handler)
    apply()
  }

  @Synchronized
  fun exit() {
    if (!active) return
    active = false
    audioManager.unregisterAudioDeviceCallback(deviceCallback)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (communicationListener as? AudioManager.OnCommunicationDeviceChangedListener)?.let {
        audioManager.removeOnCommunicationDeviceChangedListener(it)
      }
      communicationListener = null
      audioManager.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      run {
        stopSco()
        audioManager.isSpeakerphoneOn = false
      }
    }
    audioManager.mode = if (previousMode == AudioManager.MODE_IN_COMMUNICATION) AudioManager.MODE_NORMAL else previousMode
  }

  /** 지금 상황에서 가장 알맞은 통신 장치를 고른다 */
  @Synchronized
  fun apply() {
    if (!active) return
    // 다른 코드가 통신 모드를 풀었으면 되돌린다: 발화 단위 통화에서 expo-audio setAudioModeAsync 가 MODE_NORMAL 로 바꿔
    // 통화 용도 재생(CallPlayer)이 헤드셋 대신 스피커로 나갔다 (2026-10-23 Note 9 + WH-1000XM6).
    // 조건 없이 다시 지정한다 — 그 기기는 실제 모드가 NORMAL 인데 getMode() 가 IN_COMMUNICATION 을 돌려줘 비교가 통하지 않았다
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val devices = audioManager.availableCommunicationDevices
      val preferred = PREFERRED_TYPES.firstNotNullOfOrNull { type -> devices.firstOrNull { it.type == type } }
      if (preferred != null && audioManager.communicationDevice?.id != preferred.id) {
        audioManager.setCommunicationDevice(preferred)
      }
    } else {
      @Suppress("DEPRECATION")
      run {
        val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        val bluetooth = outputs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        val wired = outputs.any { it.type in WIRED_TYPES }
        if (bluetooth) {
          // 다른 코드(expo-audio setAudioModeAsync)가 스피커폰을 켜면 "통화 소리는 블루투스로" 지정이 지워지고, Android 11 이하에서
          // 앱은 setBluetoothScoOn 으로 그 지정을 되살릴 수 없다 (SCO 가 새로 연결될 때만 적용) → SCO 를 다시 연결한다 (2026-10-23 Note 9)
          if (audioManager.isSpeakerphoneOn && scoRequested) {
            audioManager.isSpeakerphoneOn = false
            stopSco()
          }
          audioManager.isSpeakerphoneOn = false
          if (!scoRequested) {
            scoRequested = true
            audioManager.startBluetoothSco()
          }
          audioManager.isBluetoothScoOn = true
        } else {
          stopSco()
          audioManager.isSpeakerphoneOn = !wired
        }
      }
    }
    emitCurrent()
  }

  @Suppress("DEPRECATION")
  private fun stopSco() {
    if (scoRequested) {
      scoRequested = false
      audioManager.stopBluetoothSco()
    }
    audioManager.isBluetoothScoOn = false
  }

  /** 지금 경로 ("bluetooth" | "wired" | "speaker" | "unknown") 와 장치 이름 */
  fun current(): Pair<String, String?> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val device = audioManager.communicationDevice ?: return "unknown" to null
      return kindOf(device.type) to device.productName?.toString()
    }
    @Suppress("DEPRECATION")
    return when {
      audioManager.isBluetoothScoOn -> "bluetooth" to null
      audioManager.isSpeakerphoneOn -> "speaker" to null
      audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in WIRED_TYPES } -> "wired" to null
      else -> "unknown" to null
    }
  }

  private fun emitCurrent() {
    val (kind, name) = current()
    onRoute(kind, name)
  }

  companion object {
    private val WIRED_TYPES = setOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET,
    )

    /** 통신 장치 우선순위: 블루투스 헤드셋(SCO·LE) > 유선 > 스피커 (수화기는 현장에서 들리지 않으므로 고르지 않는다) */
    private val PREFERRED_TYPES = listOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLE_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
    )

    fun kindOf(type: Int): String = when (type) {
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_BLE_HEADSET,
      AudioDeviceInfo.TYPE_BLE_SPEAKER -> "bluetooth"
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_USB_HEADSET -> "wired"
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
      AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "speaker"
      else -> "unknown"
    }
  }
}
