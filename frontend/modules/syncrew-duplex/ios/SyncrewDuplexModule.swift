import AVFoundation
import ExpoModulesCore

// SYNCREW 이중(동시 녹음·재생) 오디오 — iOS (docs/streaming-plan.md S3)
//   세션: playAndRecord + voiceChat + 블루투스 HFP + 스피커 기본 (헤드셋이 있으면 헤드셋)
//   캡처: AVAudioEngine 입력(voice processing = 하드웨어 에코 제거) → AVAudioConverter 로 16kHz mono PCM16 → 100ms 조각
//   재생: 같은 엔진의 AVAudioPlayerNode 에 조각을 이어 붙임. 비어 있다가 새로 시작할 때 120ms 무음(지터 버퍼)을 앞에 둔다
//   경로 변경·중단·미디어 서비스 재시작 시 엔진을 다시 만든다

public class SyncrewDuplexModule: Module {
  private lazy var duplex = DuplexEngine { [weak self] name, body in
    self?.sendEvent(name, body)
  }

  public func definition() -> ModuleDefinition {
    Name("SyncrewDuplex")

    Events("onFrame", "onRoute", "onPlayback", "onError")

    AsyncFunction("start") { (sampleRate: Double, frameMs: Int, echoCancellation: Bool, promise: Promise) in
      DuplexEngine.requestRecordPermission { granted in
        guard granted else {
          promise.reject("permission", "마이크 권한이 없습니다.")
          return
        }
        self.duplex.start(sampleRate: sampleRate, frameMs: frameMs, echoCancellation: echoCancellation) { error in
          if let error {
            promise.reject("start_failed", error.localizedDescription)
          } else {
            promise.resolve()
          }
        }
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.duplex.stop { promise.resolve() }
    }

    Function("enqueue") { (streamId: String, pcmBase64: String, sampleRate: Double) in
      self.duplex.enqueue(streamId: streamId, base64: pcmBase64, sampleRate: sampleRate)
    }

    Function("endStream") { (streamId: String) in
      self.duplex.endStream(streamId: streamId)
    }

    Function("stopPlayback") {
      self.duplex.stopPlayback()
    }

    // 실기기 시험용: 스피커 에코 제거 꺼짐(docs/streaming-plan.md 5-7절) 후보를 켠다. 앱은 개발 빌드에서만 부른다
    Function("setExperiments") { (raw: String) in
      self.duplex.setExperiments(raw)
    }

    // iOS 는 발화 단위 통화의 경로를 expo-audio(playAndRecord + 블루투스 HFP)가 잡는다 → 현재 경로만 알려 준다
    AsyncFunction("enterCallRoute") { () -> [String: Any] in
      DuplexEngine.currentRoute().mapValues { $0 ?? NSNull() }
    }

    AsyncFunction("exitCallRoute") {}

    OnDestroy {
      self.duplex.stop {}
    }
  }
}

enum DuplexError: LocalizedError {
  case format
  case noInput

  var errorDescription: String? {
    switch self {
    case .format: return "오디오 형식을 만들 수 없습니다."
    case .noInput: return "사용할 수 있는 마이크 입력이 없습니다."
    }
  }
}

// 실기기 진단 로그 (DEBUG 빌드에서만, `[duplex-diag]`): 엔진 생성·설정 변경 복구·재생 예약을 남긴다.
// 2026-10-17 iPhone 15 Pro Max 에서 voice processing 재시작 반복을 이 로그로 찾았다. 보는 법: `xcrun devicectl device process launch --console …`
@inline(__always) func dlog(_ m: @autoclosure () -> String) {
#if DEBUG
  NSLog("[duplex-diag] %@", m())
#endif
}

final class DuplexEngine {
  private var diagCaptures = 0
  private var diagConverts = 0
  typealias Emit = (String, [String: Any?]) -> Void

  private let emit: Emit
  /** 시작·정지·재생 상태는 이 큐에서만 바꾼다 */
  private let queue = DispatchQueue(label: "app.syncrew.duplex")
  /** 캡처(탭 스레드)와 엔진 재구성 사이의 보호 */
  private let captureLock = NSLock()

  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var running = false
  /** 앱이 요청한 에코 제거 (start 의 echoCancellation) */
  private var echoCancellation = true
  /**
   * 재시작 반복 보호가 voice processing 을 잠시 끈 상태. 요청(echoCancellation)과 따로 둔다 —
   * 예전에는 요청 자체를 false 로 바꿔 통화가 끝날 때까지 다시 켜지지 않았다 (2026-10-17 iPhone 15 Pro Max: 에어팟 → 스피커로 바꿔도 꺼진 채).
   * 헤드셋 연결·해제 같은 실제 경로 변경이나 세션 덮어쓰기 복구 뒤에는 다시 켜 본다.
   */
  private var vpSuppressed = false
  private var observers: [NSObjectProtocol] = []
  /** 탭·변환기를 만든 입력 형식. 설정 변경 알림 뒤 이 형식이 그대로면 엔진을 다시 만들지 않고 다시 시작만 한다 */
  private var tapFormat: AVAudioFormat?
  /** 설정 변경으로 인한 복구 시각 (짧은 시간에 반복되면 멈추고 알린다 — 실기기에서 0.4초마다 재구성이 무한 반복된 적 있음) */
  private var recoveries: [Date] = []
  private static let maxRecoveries = 4
  private static let recoveryWindow: TimeInterval = 10
  /** 지금 엔진에 voice processing 을 실제로 켰는지 (블루투스 헤드셋에서는 끈다 — 아래 shouldUseVoiceProcessing) */
  private var vpActive = false
  /**
   * 실기기 시험용 후보 (docs/streaming-plan.md 5-7절, 기본은 비어 있음 = 지금 동작). 다음 start 부터 적용:
   * - inPlace: 설정 변경으로 멈추면 엔진을 버리지 않고 그 자리에서 다시 시작 (재구성마다 voice processing 을 껐다 켜는 것이 다시 설정 변경을 부르는지)
   * - connect48 / connectHw: mainMixer → output 을 48kHz / 출력 장치 형식으로 명시 연결
   * - modeDefault: 세션 mode 를 voiceChat 대신 default (voiceChat 의 시스템 처리와 겹치는지)
   * - noIOBuffer: setPreferredIOBufferDuration 을 부르지 않음
   */
  private var experiments: Set<String> = []

  // 캡처 (captureLock)
  private var outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
  private var frameSamples = 1600
  private var converter: AVAudioConverter?
  private var pending: [Int16] = []

  // 재생 (queue)
  private let playFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24_000, channels: 1, interleaved: false)!
  private var playConverters: [Double: AVAudioConverter] = [:]
  /** 예약했지만 아직 다 재생되지 않은 버퍼 수 */
  private var scheduled = 0
  private var currentStream: String?
  /** stopPlayback·엔진 재구성 때 올려서 이전 버퍼의 완료 콜백을 무시한다 */
  private var generation = 0
  private static let jitterSeconds = 0.12

  init(emit: @escaping Emit) {
    self.emit = emit
  }

  // MARK: - 권한

  static func requestRecordPermission(_ done: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: done(true)
      case .denied: done(false)
      default: AVAudioApplication.requestRecordPermission { done($0) }
      }
    } else {
      let session = AVAudioSession.sharedInstance()
      switch session.recordPermission {
      case .granted: done(true)
      case .denied: done(false)
      default: session.requestRecordPermission { done($0) }
      }
    }
  }

  // MARK: - 시작·정지

  /** 쉼표로 나눈 후보 이름 (위 experiments). 빈 문자열이면 모두 끈다 */
  func setExperiments(_ raw: String) {
    queue.async {
      self.experiments = Set(raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
      dlog("experiments=\(self.experiments.sorted())")
    }
  }

  /** 통화 세션 mode (시험 후보 modeDefault 가 아니면 voiceChat) */
  private var sessionMode: AVAudioSession.Mode {
    experiments.contains("modeDefault") ? .default : .voiceChat
  }

  func start(sampleRate: Double, frameMs: Int, echoCancellation: Bool, done: @escaping (Error?) -> Void) {
    queue.async {
      dlog("start called running=\(self.running)")
      if self.running {
        done(nil)
        return
      }
      do {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true) else {
          throw DuplexError.format
        }
        self.echoCancellation = echoCancellation
        self.vpSuppressed = false
        self.recoveries.removeAll()
        self.captureLock.lock()
        self.outFormat = format
        self.frameSamples = max(1, Int(sampleRate) * frameMs / 1000)
        self.captureLock.unlock()
        try self.configureSession()
        try self.buildEngine()
        self.running = true
        self.addObservers()
        self.emitRoute()
        done(nil)
      } catch {
        self.teardownEngine()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        done(error)
      }
    }
  }

  func stop(done: @escaping () -> Void) {
    queue.async {
      self.removeObservers()
      let playingId = self.currentStream
      self.teardownEngine()
      if self.running {
        self.running = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      }
      if let playingId {
        self.emit("onPlayback", ["streamId": playingId, "playing": false])
      }
      done()
    }
  }

  private func configureSession() throws {
    let session = AVAudioSession.sharedInstance()
    var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
#if compiler(>=6.2)
    options.insert(.allowBluetoothHFP)
#else
    options.insert(.allowBluetooth)
#endif
    try session.setCategory(.playAndRecord, mode: sessionMode, options: options)
    // voice processing 을 켜면 출력이 44.1kHz, 입력은 48kHz 로 어긋나 iOS 가 설정을 계속 다시 잡는 일이 있었다
    // (2026-10-17 iPhone 15 Pro Max: 0.4초마다 엔진 재구성 반복) → 입출력을 48kHz 로 맞춰 둔다
    try? session.setPreferredSampleRate(48_000)
    if !experiments.contains("noIOBuffer") {
      try? session.setPreferredIOBufferDuration(0.02)
    }
    try session.setActive(true)
    dlog("session sampleRate=\(session.sampleRate) ioBuffer=\(session.ioBufferDuration) mode=\(session.mode.rawValue) route=\(DuplexEngine.currentRoute())")
    preferHeadsetInput()
  }

  /**
   * iOS voice processing(에코 제거)은 휴대폰 스피커·유선일 때만 켠다.
   * 블루투스 HFP 헤드셋과 함께 켜면 엔진이 시작 직후 설정 변경으로 멈추고 다시 만들어도 반복된다 (2026-10-17 iPhone 15 Pro Max + AirPods Pro, 약 1초 간격 무한 반복).
   * HFP 헤드셋은 마이크와 스피커가 귀에 붙어 있어 스피커폰 같은 되울림이 없고 헤드셋 자체 처리도 있으므로 끄고 쓴다.
   */
  private func shouldUseVoiceProcessing() -> Bool {
    guard echoCancellation, !vpSuppressed else { return false }
    return (DuplexEngine.currentRoute()["route"] as? String) != "bluetooth"
  }

  /**
   * 다른 코드(expo-audio 의 setAudioModeAsync·녹음기 준비 등)가 통화 중 세션 범주·모드를 바꿨으면 되돌린다. 되돌렸으면 true.
   * expo-audio 는 iOS 에서 { allowsRecording: false } 를 받으면 soloAmbient + 기본 모드로 바꾼다 → voice processing 엔진이 멈추고
   * 다시 만들어도 같은 세션이라 또 멈춰 반복 보호가 에코 제거를 껐던 것으로 본다 (2026-10-17 통화에서만 꺼짐, 점검 화면은 정상).
   * 앱 JS 쪽도 통화 중에는 바꾸지 않게 막았다 (src/audio/sessionOwner.ts) — 이것은 그래도 새는 경우의 안전장치다.
   */
  private func ensureSession(_ why: String) -> Bool {
    let session = AVAudioSession.sharedInstance()
    guard session.category != .playAndRecord || session.mode != sessionMode else { return false }
    let found = "category=\(session.category.rawValue) mode=\(session.mode.rawValue)"
    dlog("session overwritten (\(why)): \(found) — restoring playAndRecord/\(sessionMode.rawValue)")
    emit("onError", ["code": "session_overwritten", "message": "통화 중 오디오 세션이 바뀌어 되돌렸습니다 (\(found))."])
    do {
      try configureSession()
    } catch {
      emit("onError", ["code": "session_restore_failed", "message": error.localizedDescription])
      return false
    }
    // 덮어쓰기 때문에 반복 보호가 걸렸을 수 있으므로 에코 제거를 다시 켜 본다
    vpSuppressed = false
    recoveries.removeAll()
    return true
  }

  /** 블루투스 헤드셋(HFP·LE) > 유선 헤드셋 마이크 순으로 입력을 고른다 (출력도 같은 헤드셋으로 바뀐다) */
  private func preferHeadsetInput() {
    let session = AVAudioSession.sharedInstance()
    let inputs = session.availableInputs ?? []
    let preferred = inputs.first { $0.portType == .bluetoothHFP || $0.portType == .bluetoothLE }
      ?? inputs.first { $0.portType == .headsetMic || $0.portType == .usbAudio }
    if let preferred {
      try? session.setPreferredInput(preferred)
    }
  }

  private func buildEngine() throws {
    let engine = AVAudioEngine()
    let input = engine.inputNode
    vpActive = false
    if shouldUseVoiceProcessing() {
      do {
        try input.setVoiceProcessingEnabled(true)
        vpActive = true
      } catch {
        // 시뮬레이터 등 voice processing 을 못 쓰는 환경: 에코 제거 없이 계속 (세션 mode voiceChat 의 처리만)
        emit("onError", ["code": "voice_processing", "message": error.localizedDescription])
      }
    }
    let inFormat = input.outputFormat(forBus: 0)
    dlog("buildEngine inFormat=\(inFormat) target=\(outFormat) vp=\(input.isVoiceProcessingEnabled)")
    captureLock.lock()
    let target = outFormat
    captureLock.unlock()
    guard inFormat.sampleRate > 0, inFormat.channelCount > 0, let converter = AVAudioConverter(from: inFormat, to: target) else {
      throw DuplexError.noInput
    }
    converter.downmix = true
    tapFormat = inFormat
    captureLock.lock()
    self.converter = converter
    pending.removeAll(keepingCapacity: true)
    captureLock.unlock()

    input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(max(256, inFormat.sampleRate / 50)), format: inFormat) { [weak self] buffer, _ in
      self?.capture(buffer)
    }

    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: playFormat)
    let outHw = engine.outputNode.outputFormat(forBus: 0)
    if experiments.contains("connect48") || experiments.contains("connectHw") {
      let rate = experiments.contains("connect48") ? 48_000 : outHw.sampleRate
      if rate > 0, let mixFormat = AVAudioFormat(standardFormatWithSampleRate: rate, channels: max(1, outHw.channelCount)) {
        engine.connect(engine.mainMixerNode, to: engine.outputNode, format: mixFormat)
        dlog("experiment: mainMixer -> output format=\(mixFormat) (outHw=\(outHw))")
      }
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw error
    }
    player.play()
    dlog("engine started isRunning=\(engine.isRunning) route=\(DuplexEngine.currentRoute()) outHw=\(engine.outputNode.outputFormat(forBus: 0)) outIn=\(engine.outputNode.inputFormat(forBus: 0)) mixerOut=\(engine.mainMixerNode.outputFormat(forBus: 0))")
    self.engine = engine
    self.player = player
  }

  private func teardownEngine() {
    generation += 1
    scheduled = 0
    currentStream = nil
    if let engine {
      engine.inputNode.removeTap(onBus: 0)
      player?.stop()
      engine.stop()
      if vpActive {
        try? engine.inputNode.setVoiceProcessingEnabled(false)
      }
    }
    engine = nil
    player = nil
    tapFormat = nil
    playConverters.removeAll()
    captureLock.lock()
    converter = nil
    pending.removeAll()
    captureLock.unlock()
  }

  /** 경로·형식이 바뀌면 엔진을 새로 만든다 (재생 중이던 조각은 버린다) */
  private func restartEngine() {
    let playingId = currentStream
    teardownEngine()
    do {
      try buildEngine()
    } catch {
      emit("onError", ["code": "restart_failed", "message": error.localizedDescription])
    }
    if let playingId {
      emit("onPlayback", ["streamId": playingId, "playing": false])
    }
    emitRoute()
  }

  /**
   * 설정 변경(AVAudioEngineConfigurationChange)으로 엔진이 멈췄을 때: 엔진을 다시 만든다.
   * 실기기(iPhone 15 Pro Max, 2026-10-17)에서 voice processing 을 켠 엔진이 시작 직후 설정 변경으로 멈추고,
   * 다시 만들면 또 멈추는 일이 0.4초 간격으로 끝없이 반복된 적이 있다. 짧은 시간에 반복되면
   * voice processing(에코 제거)을 끄고 한 번 더 만들고, 그래도 반복되면 멈추고 알린다.
   */
  private func recoverEngine() {
    // 세션이 덮어써져 멈춘 것이면 세션부터 되돌린다 (그대로 다시 만들면 같은 이유로 또 멈춘다)
    _ = ensureSession("config change")
    let now = Date()
    recoveries = recoveries.filter { now.timeIntervalSince($0) < DuplexEngine.recoveryWindow } + [now]
    if recoveries.count > DuplexEngine.maxRecoveries * 2 {
      dlog("recover: too many (\(recoveries.count)) — giving up")
      emit("onError", ["code": "restart_loop", "message": "오디오 엔진이 계속 다시 시작되어 멈췄습니다."])
      return
    }
    if recoveries.count > DuplexEngine.maxRecoveries, echoCancellation, !vpSuppressed {
      dlog("recover: restart loop with voice processing — suppressing it until the route changes")
      vpSuppressed = true
      emit("onError", ["code": "voice_processing_loop", "message": "에코 제거를 끄고 오디오를 다시 시작합니다."])
    }
    if experiments.contains("inPlace"), vpActive == shouldUseVoiceProcessing(), restartInPlace() { return }
    dlog("recover: rebuilding engine (#\(recoveries.count), requested=\(echoCancellation) suppressed=\(vpSuppressed))")
    restartEngine()
  }

  /**
   * 시험 후보 inPlace: 엔진을 버리지 않고(voice processing 도 그대로 둔 채) 다시 시작한다. 됐으면 true.
   * 입력 형식이 바뀌었거나 시작에 실패하면 false → 예전처럼 엔진을 새로 만든다.
   */
  private func restartInPlace() -> Bool {
    guard let engine, let player, let tapFormat else { return false }
    let inFormat = engine.inputNode.outputFormat(forBus: 0)
    guard inFormat == tapFormat else {
      dlog("inPlace: input format changed \(tapFormat) -> \(inFormat), rebuilding")
      return false
    }
    let playingId = currentStream
    generation += 1
    scheduled = 0
    currentStream = nil
    player.stop()
    engine.prepare()
    do {
      try engine.start()
    } catch {
      dlog("inPlace: start failed \(error.localizedDescription), rebuilding")
      return false
    }
    player.play()
    dlog("inPlace: restarted (#\(recoveries.count)) isRunning=\(engine.isRunning) vp=\(engine.inputNode.isVoiceProcessingEnabled) outHw=\(engine.outputNode.outputFormat(forBus: 0))")
    if let playingId {
      emit("onPlayback", ["streamId": playingId, "playing": false])
    }
    emitRoute()
    return true
  }

  // MARK: - 캡처 (탭 스레드)

  private func capture(_ buffer: AVAudioPCMBuffer) {
    captureLock.lock()
    defer { captureLock.unlock() }
    diagCaptures += 1
    if diagCaptures <= 3 || diagCaptures % 100 == 0 { dlog("tap #\(diagCaptures) frames=\(buffer.frameLength) fmt=\(buffer.format) converter=\(converter != nil)") }
    guard let converter, buffer.frameLength > 0 else { return }
    let ratio = outFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
    var fed = false
    var error: NSError?
    let status = converter.convert(to: out, error: &error) { _, inputStatus in
      if fed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      fed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    diagConverts += 1
    if diagConverts <= 3 || diagConverts % 100 == 0 { dlog("convert #\(diagConverts) status=\(status.rawValue) out=\(out.frameLength) err=\(String(describing: error))") }
    guard status != .error, out.frameLength > 0, let channel = out.int16ChannelData else { return }
    pending.append(contentsOf: UnsafeBufferPointer(start: channel[0], count: Int(out.frameLength)))

    while pending.count >= frameSamples {
      let frame = Array(pending[0..<frameSamples])
      pending.removeFirst(frameSamples)
      let data = frame.withUnsafeBufferPointer { Data(buffer: $0) }
      emit("onFrame", ["pcm": data.base64EncodedString(), "timestamp": Date().timeIntervalSince1970 * 1000])
    }
  }

  // MARK: - 재생

  func enqueue(streamId: String, base64: String, sampleRate: Double) {
    queue.async {
      guard self.running, let player = self.player, let data = Data(base64Encoded: base64), data.count >= 2 else {
        dlog("enqueue dropped running=\(self.running) player=\(self.player != nil) b64len=\(base64.count)")
        return
      }
      guard let buffer = self.makePlayBuffer(data, sampleRate: sampleRate) else { return }
      if self.scheduled == 0, let silence = self.silence(seconds: DuplexEngine.jitterSeconds) {
        self.schedule(silence, on: player)
      }
      if self.currentStream != streamId {
        self.currentStream = streamId
        self.emit("onPlayback", ["streamId": streamId, "playing": true])
      }
      self.schedule(buffer, on: player)
      if self.scheduled <= 2 { dlog("enqueue stream=\(streamId) scheduled=\(self.scheduled) playerPlaying=\(player.isPlaying) engineRunning=\(self.engine?.isRunning ?? false)") }
    }
  }

  func endStream(streamId: String) {
    queue.async { self.settle() }
  }

  func stopPlayback() {
    queue.async {
      self.generation += 1
      self.scheduled = 0
      if let player = self.player {
        player.stop()
        if self.running { player.play() }
      }
      if let playingId = self.currentStream {
        self.currentStream = nil
        self.emit("onPlayback", ["streamId": playingId, "playing": false])
      }
    }
  }

  private func schedule(_ buffer: AVAudioPCMBuffer, on player: AVAudioPlayerNode) {
    scheduled += 1
    let scheduledGeneration = generation
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self else { return }
      self.queue.async {
        guard scheduledGeneration == self.generation else { return }
        self.scheduled = max(0, self.scheduled - 1)
        if self.scheduled <= 1 { dlog("played back, remaining=\(self.scheduled)") }
        self.settle()
      }
    }
  }

  /** 예약된 소리가 모두 끝났으면 멈춤 알림 (웹 구현과 같은 규칙: 조각이 늦어 비어도 멈춤으로 알린다) */
  private func settle() {
    if scheduled == 0, let playingId = currentStream {
      currentStream = nil
      emit("onPlayback", ["streamId": playingId, "playing": false])
    }
  }

  private func makePlayBuffer(_ data: Data, sampleRate: Double) -> AVAudioPCMBuffer? {
    let count = data.count / 2
    guard let source = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
          let buffer = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(count)),
          let channel = buffer.floatChannelData else { return nil }
    buffer.frameLength = AVAudioFrameCount(count)
    data.withUnsafeBytes { raw in
      for i in 0..<count {
        let sample = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))
        channel[0][i] = Float(sample) / 32768
      }
    }
    if sampleRate == playFormat.sampleRate { return buffer }

    let converter: AVAudioConverter
    if let cached = playConverters[sampleRate] {
      converter = cached
    } else {
      guard let created = AVAudioConverter(from: source, to: playFormat) else { return nil }
      playConverters[sampleRate] = created
      converter = created
    }
    let capacity = AVAudioFrameCount(Double(count) * playFormat.sampleRate / sampleRate) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: capacity) else { return nil }
    var fed = false
    var error: NSError?
    let status = converter.convert(to: out, error: &error) { _, inputStatus in
      if fed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      fed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    return status == .error || out.frameLength == 0 ? nil : out
  }

  private func silence(seconds: Double) -> AVAudioPCMBuffer? {
    let frames = AVAudioFrameCount(playFormat.sampleRate * seconds)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: frames), let channel = buffer.floatChannelData else { return nil }
    buffer.frameLength = frames
    channel[0].initialize(repeating: 0, count: Int(frames))
    return buffer
  }

  // MARK: - 경로·중단 알림

  static func currentRoute() -> [String: Any?] {
    let route = AVAudioSession.sharedInstance().currentRoute
    let ports = route.inputs + route.outputs
    func kind(_ type: AVAudioSession.Port) -> String {
      switch type {
      case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE: return "bluetooth"
      case .headphones, .headsetMic, .usbAudio: return "wired"
      case .builtInSpeaker, .builtInReceiver, .builtInMic: return "speaker"
      default: return "unknown"
      }
    }
    for wanted in ["bluetooth", "wired", "speaker"] {
      if let port = ports.first(where: { kind($0.portType) == wanted }) {
        return ["route": wanted, "name": port.portName]
      }
    }
    return ["route": "unknown", "name": nil]
  }

  /** 경로와 함께 지금 엔진의 에코 제거(voice processing) 상태를 알린다 — 실기기 확인용으로 앱이 개발 빌드에서 Metro 에 찍는다 */
  private func emitRoute() {
    var body = DuplexEngine.currentRoute()
    body["voiceProcessing"] = vpActive
    emit("onRoute", body)
  }

  private func addObservers() {
    removeObservers()
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
      let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
      let reason = raw.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
      self?.queue.async {
        guard let self, self.running else { return }
        dlog("route change reason=\(raw.map { String($0) } ?? "nil") route=\(DuplexEngine.currentRoute()) vpActive=\(self.vpActive) suppressed=\(self.vpSuppressed)")
        if reason == .categoryChange, self.engine != nil, self.ensureSession("route change") {
          self.restartEngine()
          return
        }
        if reason == .newDeviceAvailable { self.preferHeadsetInput() }
        // 실제 장치가 바뀌면(헤드셋 연결·해제, 출력 지정) 반복 보호로 꺼 둔 에코 제거를 다시 켜 본다
        if reason == .newDeviceAvailable || reason == .oldDeviceUnavailable || reason == .override, self.vpSuppressed {
          dlog("route change: device changed — retrying voice processing")
          self.vpSuppressed = false
        }
        // 헤드셋이 붙거나 떨어져 voice processing 을 켜야 할지가 바뀌면 엔진을 다시 만든다
        let wantVP = self.shouldUseVoiceProcessing()
        if wantVP != self.vpActive, self.engine != nil {
          dlog("route change: vp \(self.vpActive) -> \(wantVP), rebuilding")
          self.recoveries.removeAll()
          self.restartEngine()
        }
        self.emitRoute()
      }
    })
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil) { [weak self] note in
      self?.queue.async {
        guard let self, self.running, let engine = self.engine, (note.object as AnyObject?) === engine else { return }
        // 형식이 바뀌면 엔진이 멈춘다. 아직 돌고 있으면(재구성 직후 알림 등) 그대로 둔다
        dlog("configChange isRunning=\(engine.isRunning)")
        if !engine.isRunning { self.recoverEngine() }
      }
    })
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      guard raw.flatMap({ AVAudioSession.InterruptionType(rawValue: $0) }) == .ended else { return }
      self?.queue.async {
        guard let self, self.running else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        if !(self.engine?.isRunning ?? false) { self.restartEngine() }
      }
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in
      self?.queue.async {
        guard let self, self.running else { return }
        try? self.configureSession()
        self.restartEngine()
      }
    })
  }

  private func removeObservers() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers.removeAll()
  }
}
