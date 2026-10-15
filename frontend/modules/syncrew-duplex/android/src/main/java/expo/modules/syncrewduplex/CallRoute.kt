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
        audioManager.stopBluetoothSco()
        audioManager.isBluetoothScoOn = false
        audioManager.isSpeakerphoneOn = false
      }
    }
    audioManager.mode = if (previousMode == AudioManager.MODE_IN_COMMUNICATION) AudioManager.MODE_NORMAL else previousMode
  }

  /** 지금 상황에서 가장 알맞은 통신 장치를 고른다 */
  @Synchronized
  fun apply() {
    if (!active) return
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
          audioManager.isSpeakerphoneOn = false
          audioManager.startBluetoothSco()
          audioManager.isBluetoothScoOn = true
        } else {
          if (audioManager.isBluetoothScoOn) {
            audioManager.stopBluetoothSco()
            audioManager.isBluetoothScoOn = false
          }
          audioManager.isSpeakerphoneOn = !wired
        }
      }
    }
    emitCurrent()
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
