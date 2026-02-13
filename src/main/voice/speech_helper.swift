import Foundation
import Speech
import AVFoundation

/// Lightweight CLI that wraps SFSpeechRecognizer for on-device dictation.
/// Communicates with the parent Electron process via JSON over stdin/stdout.
///
/// Commands (stdin, one JSON per line):
///   {"command":"start"}
///   {"command":"stop"}
///   {"command":"quit"}
///
/// Events (stdout, one JSON per line):
///   {"type":"ready","onDevice":true}
///   {"type":"interim","text":"..."}
///   {"type":"final","text":"..."}
///   {"type":"error","message":"..."}
///   {"type":"stopped"}

class SpeechHelper: NSObject, SFSpeechRecognizerDelegate {
    private let speechRecognizer = SFSpeechRecognizer(
        locale: Locale(identifier: "en-US")
    )!
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var isRunning = false

    override init() {
        super.init()
        speechRecognizer.delegate = self
    }

    private func emit(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(
            withJSONObject: dict
        ),
        let json = String(data: data, encoding: .utf8)
        else { return }
        FileHandle.standardOutput.write(
            Data((json + "\n").utf8)
        )
    }

    private func emitError(_ msg: String) {
        emit(["type": "error", "message": msg])
    }

    func requestAuth(
        completion: @escaping (Bool) -> Void
    ) {
        SFSpeechRecognizer.requestAuthorization { status in
            completion(status == .authorized)
            if status != .authorized {
                self.emitError(
                    "Speech recognition not authorised"
                )
            }
        }
    }

    func startRecording() {
        guard !isRunning else { return }
        recognitionTask?.cancel()
        recognitionTask = nil

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if speechRecognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let fmt = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(
            onBus: 0, bufferSize: 1024, format: fmt
        ) { buffer, _ in
            request.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            emitError("Audio engine: \(error.localizedDescription)")
            return
        }

        recognitionTask = speechRecognizer.recognitionTask(
            with: request
        ) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    self.emit(["type": "final", "text": text])
                } else {
                    self.emit(["type": "interim", "text": text])
                }
            }
            if let error = error {
                let ns = error as NSError
                // 216 = cancelled (expected on stop)
                if ns.domain == "kAFAssistantErrorDomain"
                    && ns.code == 216 { return }
                self.emitError(error.localizedDescription)
                self.stopRecording()
            }
        }
        isRunning = true
    }

    func stopRecording() {
        guard isRunning else { return }
        isRunning = false
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        emit(["type": "stopped"])
    }

    func speechRecognizer(
        _ sr: SFSpeechRecognizer,
        availabilityDidChange available: Bool
    ) {
        if !available {
            emitError("Speech recognizer became unavailable")
        }
    }
}

// MARK: - Entry point

let helper = SpeechHelper()
helper.requestAuth { ok in
    guard ok else { exit(1) }

    let onDevice = SFSpeechRecognizer(
        locale: Locale(identifier: "en-US")
    )?.supportsOnDeviceRecognition ?? false

    let ready = try! JSONSerialization.data(
        withJSONObject: ["type": "ready", "onDevice": onDevice]
    )
    FileHandle.standardOutput.write(ready + Data("\n".utf8))

    DispatchQueue.global().async {
        while let line = readLine() {
            guard let d = line.data(using: .utf8),
                  let j = try? JSONSerialization.jsonObject(
                      with: d
                  ) as? [String: String],
                  let cmd = j["command"]
            else { continue }
            DispatchQueue.main.async {
                switch cmd {
                case "start": helper.startRecording()
                case "stop":  helper.stopRecording()
                case "quit":  helper.stopRecording(); exit(0)
                default: break
                }
            }
        }
        DispatchQueue.main.async {
            helper.stopRecording(); exit(0)
        }
    }
}

RunLoop.main.run()