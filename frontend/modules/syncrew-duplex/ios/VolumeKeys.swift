import AVFoundation
import MediaPlayer
import UIKit

// 통화 중 음량 버튼으로 상대 바꾸기 (C1, docs/implementation-plan.md C1 3·4단계) — iOS
//   iOS 는 음량 버튼 누름을 직접 받는 공식 방법이 없다 → 오디오 세션 음량(outputVolume)이 바뀔 때마다 누름 하나로 알린다.
//   누를 때마다 되돌리지 않는다: 시스템이 이미 한 칸 바꿨으므로 한 번 누름은 그대로 두고(JS 의 stepVolume 은 iOS 에서 아무것도 안 함),
//   두 번 누름으로 판정되면 JS 가 restoreVolume() 을 불러 처음 누르기 전 음량으로 한 번에 되돌린다
//   (그 사이 아주 짧게 바뀌었다 돌아오는 것은 괜찮다 — 사용자 10-26).
//   10-26 실기기에서 바꾼 이유: 누를 때마다 되돌리면 되돌리기와 다음 누름이 겹쳐 ① 되돌리기 ↔ 누름이 맞물려 돌고
//   ② 두 번 누름이 큰 변화 하나로 합쳐져 놓쳤다. 또 통화 중 음량은 한 칸이 0.05(일반 음량 1/16)라 칸 크기로 판정할 수 없다.
//   화면 밖에 MPVolumeView 를 두면 시스템 음량 표시가 뜨지 않고, 그 안의 슬라이더로 음량을 바꿀 수 있다.
//   휴대폰 버튼과 블루투스 헤드셋 음량 조절(에어팟·WH-1000XM6)이 모두 outputVolume 으로 들어온다.
//   이미 최대(최소)이면 증가(감소)를 눌러도 값이 안 바뀌어 알 수 없다 (10-26 확인) → 지켜보는 동안 음량을
//   한 칸 ~ 최대-한 칸 안에 둔다 (사용자 10-26: 최저 1, 최고 최대-1). 그래서 지켜보는 동안은 소리를 0 으로 끌 수 없다.
//   ⚠ outputVolume 알림은 세션이 켜져 있을 때 온다 → 지켜보는 동안 세션을 켜 둔다 (이중 오디오가 멈추며 끄면 다시 켠다).

final class VolumeKeys {
  private static let lowest: Float = 1.0 / 16
  private static let highest: Float = 1 - 1.0 / 16
  /** 이보다 작은 변화는 누름이 아니다 (통화 음량 한 칸 0.05, 일반 음량 한 칸 0.0625) */
  private static let minChange: Float = 0.01
  /** 앱이 맞춘 값(되돌리기·범위 맞추기)이 알림으로 돌아온 것으로 보는 시간과 거리 (한 칸 0.05 의 절반보다 가깝게) */
  private static let selfChangeMemory: TimeInterval = 0.6
  private static let selfChangeDistance: Float = 0.02
  /** 연속 누름 묶음: 마지막 누름 뒤 이 시간이 지나면 다음 누름은 새 묶음 (되돌릴 기준값을 새로 잡는다) */
  private static let pressGroupGap: TimeInterval = 1.0
  /** 반복 보호: 1초에 이보다 많이 바뀌면(제어 센터 슬라이더를 끄는 등) 1초 쉰다 */
  private static let maxPressesPerSecond = 6
  /** 경로·설정이 바뀐 직후의 음량 변화는 누름이 아니다 (통화 음량과 일반 음량이 따로라 저절로 바뀐다) */
  private static let settleWindow: TimeInterval = 1.0

  private let onPress: (String) -> Void
  private var observation: NSKeyValueObservation?
  private var sessionObservers: [NSObjectProtocol] = []
  private var volumeView: MPVolumeView?
  /** 마지막으로 본 음량 */
  private var lastValue: Float = 0
  /** 이번 누름 묶음이 시작되기 전 음량 (두 번 누름이면 여기로 되돌린다) */
  private var pressBase: Float?
  private var lastPressAt = Date.distantPast
  private var recentSets: [(value: Float, at: Date)] = []
  private var pressTimes: [Date] = []
  private var pausedUntil = Date.distantPast
  /**
   * 10-26 iPhone 17 Pro: 상대가 받아 통화 오디오가 켜지자마자 음량이 저절로 두 번 바뀌어 "두 번 누름" 으로 잡혔다
   * (매번, 받은 뒤 0.15–0.27초에 다음 사람으로 넘어감) → 이 동안은 새 기준값으로만 본다
   */
  private var settleUntil = Date.distantPast
  private(set) var watching = false

  init(onPress: @escaping (String) -> Void) {
    self.onPress = onPress
  }

  func start() {
    DispatchQueue.main.async {
      self.activateSession()
      guard !self.watching else { return }
      self.watching = true
      self.attachVolumeView()
      let session = AVAudioSession.sharedInstance()
      self.lastValue = session.outputVolume
      self.keepInRange()
      self.observation = session.observe(\.outputVolume, options: [.new]) { [weak self] _, change in
        guard let value = change.newValue else { return }
        DispatchQueue.main.async { self?.changed(value) }
      }
      let center = NotificationCenter.default
      for name in [AVAudioSession.routeChangeNotification, AVAudioSession.interruptionNotification] {
        self.sessionObservers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
          self?.settleNow(note.name.rawValue)
        })
      }
      dlog("volume keys start volume=\(self.lastValue)")
    }
  }

  /** stop 뒤 세션을 끌지는 부르는 쪽이 정한다 (이중 오디오가 돌고 있으면 끄지 않는다) */
  func stop(deactivate: Bool) {
    DispatchQueue.main.async {
      guard self.watching else { return }
      self.watching = false
      self.observation?.invalidate()
      self.observation = nil
      self.sessionObservers.forEach { NotificationCenter.default.removeObserver($0) }
      self.sessionObservers.removeAll()
      self.volumeView?.removeFromSuperview()
      self.volumeView = nil
      self.pressBase = nil
      if deactivate {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      }
      dlog("volume keys stop")
    }
  }

  /** 이중 오디오가 멈추며 세션을 껐을 때: 지켜보는 중이면 다시 켠다 (통화 상대를 바꾸는 사이 울림 중에도 버튼을 받게) */
  func sessionReleased() {
    DispatchQueue.main.async {
      guard self.watching else { return }
      self.activateSession()
      self.settleNow("session released")
    }
  }

  /** 이중 오디오가 세션을 바꾸기 전·후 (모듈이 부른다): 잠시 음량 변화를 누름으로 세지 않는다 */
  func settle(_ why: String) {
    DispatchQueue.main.async { self.settleNow(why) }
  }

  /** 두 번 누름으로 판정됐을 때 (JS): 이번 누름 묶음 전 음량으로 되돌린다 */
  func restore() {
    DispatchQueue.main.async {
      guard let base = self.pressBase else { return }
      self.pressBase = nil
      let target = Self.clamped(base)
      dlog("volume restore \(self.lastValue) -> \(target)")
      self.setVolume(target)
    }
  }

  private func settleNow(_ why: String) {
    guard watching else { return }
    settleUntil = Date().addingTimeInterval(Self.settleWindow)
    pressBase = nil
    lastValue = AVAudioSession.sharedInstance().outputVolume
    dlog("volume settle (\(why)) volume=\(lastValue)")
    keepInRange()
  }

  private func changed(_ value: Float) {
    guard watching else { return }
    let now = Date()
    let previous = lastValue
    lastValue = value
    recentSets.removeAll { now.timeIntervalSince($0.at) > Self.selfChangeMemory }
    // 앱이 맞춘 값이 알림으로 돌아온 것
    if recentSets.contains(where: { abs($0.value - value) < Self.selfChangeDistance }) {
      dlog("volume self \(value)")
      return
    }
    if now < settleUntil {
      dlog("volume settling \(value)")
      return
    }
    if abs(value - previous) < Self.minChange { return }
    if now < pausedUntil {
      keepInRange()
      return
    }
    pressTimes = pressTimes.filter { now.timeIntervalSince($0) < 1 } + [now]
    if pressTimes.count > Self.maxPressesPerSecond {
      pausedUntil = now.addingTimeInterval(1)
      pressTimes.removeAll()
      pressBase = nil
      dlog("volume loop guard: 1초 쉼 value=\(value)")
      keepInRange()
      return
    }
    if pressBase == nil || now.timeIntervalSince(lastPressAt) > Self.pressGroupGap { pressBase = previous }
    lastPressAt = now
    let direction = value > previous ? "up" : "down"
    dlog("volume key \(direction) \(previous) -> \(value) base=\(pressBase ?? -1)")
    onPress(direction)
    // 끝에 닿았으면 한 칸 안쪽으로 (다음 누름도 알 수 있게)
    keepInRange()
  }

  private static func clamped(_ value: Float) -> Float {
    min(highest, max(lowest, value))
  }

  /** 음량이 끝(0·최대) 쪽이면 한 칸 안쪽으로 옮긴다 */
  private func keepInRange() {
    let target = Self.clamped(lastValue)
    guard abs(target - lastValue) >= 0.001 else { return }
    dlog("volume keep in range \(lastValue) -> \(target)")
    setVolume(target)
  }

  private func activateSession() {
    do {
      try AVAudioSession.sharedInstance().setActive(true)
    } catch {
      dlog("volume keys setActive failed \(error)")
    }
  }

  private func attachVolumeView() {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    let view = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 1, height: 1))
    view.alpha = 0.01
    view.isUserInteractionEnabled = false
    window?.addSubview(view)
    volumeView = view
  }

  private func setVolume(_ value: Float) {
    recentSets.append((value, Date()))
    guard let slider = volumeView?.subviews.compactMap({ $0 as? UISlider }).first else {
      dlog("volume keys: slider 없음")
      return
    }
    // 슬라이더를 바로 바꾸면 무시될 때가 있어 다음 차례에 바꾼다
    DispatchQueue.main.async {
      slider.value = value
      slider.sendActions(for: .valueChanged)
    }
  }
}
