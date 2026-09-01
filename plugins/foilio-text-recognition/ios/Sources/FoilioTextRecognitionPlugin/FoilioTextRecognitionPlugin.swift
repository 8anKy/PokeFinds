import Foundation
import UIKit
import Vision
import Capacitor

/**
 * Foilio — on-device textigenkänning via Apple Vision (VNRecognizeTextRequest).
 *
 * VARFÖR EN EGEN PLUGIN: ML Kit-pluginet (@capacitor-mlkit/text-recognition) är
 * CocoaPods-only på iOS (Googles ML Kit saknar SPM) medan ios/App genereras som
 * SPM-projekt av `cap add ios` i Codemagic. Vision är ett systemramverk: noll
 * beroenden, noll binärtillväxt, offline, gratis. Läser tryckta siffror minst
 * lika bra som ML Kit. Android kör ML Kit-pluginet — samma JS-kontrakt i
 * src/lib/on-device-number.ts.
 *
 * KONTRAKT: recognize({ base64, languages? }) → { text, lines }.
 *   base64    = JPEG/PNG utan data-URL-prefix (nummerremsan, ~1280×280 px).
 *   languages = valfria BCP-47-koder; filtreras mot enhetens stödda lista så
 *               en okänd kod (t.ex. "ja-JP" före iOS 16) aldrig fäller anropet.
 *   text      = raderna sammanfogade med "\n", i Visions läsordning.
 *
 * ⚠️ Kompileras FÖRST i Codemagic (ägaren är på Windows) — håll filen minimal
 * och nära Capacitors plugin-mall.
 */
@objc(FoilioTextRecognitionPlugin)
public class FoilioTextRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoilioTextRecognitionPlugin"
    public let jsName = "FoilioTextRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    @objc public func recognize(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64, options: [.ignoreUnknownCharacters]),
              let image = UIImage(data: data),
              let cgImage = image.cgImage else {
            call.reject("decode")
            return
        }
        let languages = call.getArray("languages", String.self) ?? []

        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }
                let observations = request.results as? [VNRecognizedTextObservation] ?? []
                let lines = observations.compactMap { $0.topCandidates(1).first?.string }
                call.resolve([
                    "text": lines.joined(separator: "\n"),
                    "lines": lines
                ])
            }
            // Siffror, inte ord: språkkorrigering skulle "rätta" 042/165 till text.
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            if !languages.isEmpty {
                let supported = (try? request.supportedRecognitionLanguages()) ?? []
                let wanted = languages.filter { supported.contains($0) }
                if !wanted.isEmpty {
                    request.recognitionLanguages = wanted
                }
            }
            // Canvas-JPEG bär ingen EXIF-orientering → .up.
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
            do {
                try handler.perform([request])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}
