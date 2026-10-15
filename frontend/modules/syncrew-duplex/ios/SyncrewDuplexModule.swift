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

final class DuplexEngine {
  typealias Emit = (String, [String: Any?]) -> Void

  private let emit: Emit
  /** 시작·정지·재생 상태는 이 큐에서만 바꾼다 */
  private let queue = DispatchQueue(label: "app.syncrew.duplex")
  /** 캡처(탭 스레드)와 엔진 재구성 사이의 보호 */
  private let captureLock = NSLock()

  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var running = false
  private var echoCancellation = true
  private var observers: [NSObjectProtocol] = []

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

  func start(sampleRate: Double, frameMs: Int, echoCancellation: Bool, done: @escaping (Error?) -> Void) {
    queue.async {
      if self.running {
        done(nil)
        return
      }
      do {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true) else {
          throw DuplexError.format
        }
        self.echoCancellation = echoCancellation
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
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
    try? session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true)
    preferHeadsetInput()
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
    if echoCancellation {
      do {
        try input.setVoiceProcessingEnabled(true)
      } catch {
        // 시뮬레이터 등 voice processing 을 못 쓰는 환경: 에코 제거 없이 계속 (세션 mode voiceChat 의 처리만)
        emit("onError", ["code": "voice_processing", "message": error.localizedDescription])
      }
    }
    let inFormat = input.outputFormat(forBus: 0)
    captureLock.lock()
    let target = outFormat
    captureLock.unlock()
    guard inFormat.sampleRate > 0, inFormat.channelCount > 0, let converter = AVAudioConverter(from: inFormat, to: target) else {
      throw DuplexError.noInput
    }
    converter.downmix = true
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
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw error
    }
    player.play()
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
      if echoCancellation {
        try? engine.inputNode.setVoiceProcessingEnabled(false)
      }
    }
    engine = nil
    player = nil
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

  // MARK: - 캡처 (탭 스레드)

  private func capture(_ buffer: AVAudioPCMBuffer) {
    captureLock.lock()
    defer { captureLock.unlock() }
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
      guard self.running, let player = self.player, let data = Data(base64Encoded: base64), data.count >= 2 else { return }
      guard let buffer = self.makePlayBuffer(data, sampleRate: sampleRate) else { return }
      if self.scheduled == 0, let silence = self.silence(seconds: DuplexEngine.jitterSeconds) {
        self.schedule(silence, on: player)
      }
      if self.currentStream != streamId {
        self.currentStream = streamId
        self.emit("onPlayback", ["streamId": streamId, "playing": true])
      }
      self.schedule(buffer, on: player)
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

  private func emitRoute() {
    emit("onRoute", DuplexEngine.currentRoute())
  }

  private func addObservers() {
    removeObservers()
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
      let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
      let reason = raw.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
      self?.queue.async {
        guard let self, self.running else { return }
        if reason == .newDeviceAvailable { self.preferHeadsetInput() }
        self.emitRoute()
      }
    })
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil) { [weak self] note in
      self?.queue.async {
        guard let self, self.running, let engine = self.engine, (note.object as AnyObject?) === engine else { return }
        // 형식이 바뀌면 엔진이 멈춘다. 아직 돌고 있으면(재구성 직후 알림 등) 그대로 둔다
        if !engine.isRunning { self.restartEngine() }
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
