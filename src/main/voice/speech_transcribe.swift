import Foundation
import Speech

/// File-based speech transcription using macOS SFSpeechRecognizer.
/// Usage: speech_transcribe <audio_file_path>
/// Outputs transcribed text to stdout, errors to stderr.

setbuf(stdout, nil)

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: speech_transcribe <audio_file>\n", stderr)
    exit(1)
}

let filePath = CommandLine.arguments[1]
let fileURL = URL(fileURLWithPath: filePath)

guard FileManager.default.fileExists(atPath: filePath) else {
    fputs("File not found: \(filePath)\n", stderr)
    exit(1)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) else {
    fputs("SFSpeechRecognizer not available\n", stderr)
    exit(1)
}

let request = SFSpeechURLRecognitionRequest(url: fileURL)
if recognizer.supportsOnDeviceRecognition {
    request.requiresOnDeviceRecognition = true
}

let sem = DispatchSemaphore(value: 0)
var finalText = ""
var encounteredError: String? = nil

recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        finalText = result.bestTranscription.formattedString
        if result.isFinal {
            sem.signal()
        }
    }
    if let error = error {
        encounteredError = error.localizedDescription
        sem.signal()
    }
}

let waitResult = sem.wait(timeout: .now() + 30)

if waitResult == .timedOut {
    fputs("Transcription timed out\n", stderr)
    exit(1)
} else if let err = encounteredError {
    fputs("Error: \(err)\n", stderr)
    exit(1)
} else {
    print(finalText)
    exit(0)
}
