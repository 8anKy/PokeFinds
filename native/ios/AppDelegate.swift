// ⛔ DEN HÄR FILEN KOPIERAS ÖVER Capacitors genererade ios/App/App/AppDelegate.swift AV
//    CODEMAGIC (codemagic.yaml, steget efter `cap add ios`). ios/ är gitignorerad och
//    genereras färskt vid varje bygge — ändra HÄR, aldrig i ios/. Innehåller allt som
//    förut perl-injicerades (APNs-token-vidarebefordran, killBounce) + push-öppningen.
import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    // ── PUSH → BUTIKEN DIREKT, UTAN ATT VÄNTA PÅ WEBVIEW:EN (ägarbeslut 2026-09-17) ──
    // Ett restock-larm bär butikens korg-/produktlänk i `url`. Förut öppnades den av
    // JS (push-manager.tsx) — dvs FÖRST bootade Foilio, sedan Safari. Restock är ett
    // lopp; sekunderna i vår laddningsskärm är förlorade sekunder. Här öppnas länken
    // natively i samma ögonblick som trycket kommer:
    //   • KALLSTART: iOS levererar notisen i launchOptions[.remoteNotification].
    //   • VARM APP: vi lägger oss som UNUserNotificationCenter-delegat ovanpå
    //     Capacitors NotificationRouter och vidarebefordrar allt till den (så pushen
    //     når JS precis som förut — registrering, willPresent, actionPerformed).
    // JS hoppar över window.open för http-länkar när UA:n bär FoilioApp/≥1.3, annars
    // hade samma sida öppnats två gånger. Interna vägar ("/produkter/…") rör vi inte.
    private var capacitorNotificationDelegate: UNUserNotificationCenterDelegate?
    private var lastOpened: (url: String, at: Date)?

    // Push: Capacitor levererar APNs-token via NotificationCenter, men mallens
    // AppDelegate postar den INTE (verifierat även i Capacitor 8-mallen) →
    // register() ger varken token eller fel (tyst). Vidarebefordra båda.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if let payload = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            openExternalUrl(from: payload)
        }
        // Capacitors bridge sätter sin router som delegat när rot-vyn laddas — efter
        // den här metoden. Installera omslaget först när det finns något att omsluta.
        DispatchQueue.main.async { [weak self] in self?.installNotificationInterceptor() }
        return true
    }

    private func installNotificationInterceptor() {
        let center = UNUserNotificationCenter.current()
        guard let existing = center.delegate, existing !== self else {
            // Ingen delegat än (bridgen sen) — försök igen strax; ge upp tyst efter det.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self = self, UNUserNotificationCenter.current().delegate !== self else { return }
                if let d = UNUserNotificationCenter.current().delegate {
                    self.capacitorNotificationDelegate = d
                    UNUserNotificationCenter.current().delegate = self
                }
            }
            return
        }
        capacitorNotificationDelegate = existing
        center.delegate = self
    }

    /// Öppnar `url` ur notisens payload i systemets webbläsare om den är extern (http/https).
    /// Returnerar false för interna vägar och saknad url — då gör JS som förut.
    @discardableResult
    private func openExternalUrl(from payload: [AnyHashable: Any]) -> Bool {
        guard let raw = payload["url"] as? String,
              raw.hasPrefix("http://") || raw.hasPrefix("https://"),
              let url = URL(string: raw) else { return false }
        // Samma länk inom tre sekunder (launchOptions + didReceive på kallstart) = ett tryck.
        if let last = lastOpened, last.url == raw, Date().timeIntervalSince(last.at) < 3 { return true }
        lastOpened = (raw, Date())
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        return true
    }

    // MARK: UNUserNotificationCenterDelegate — omslag runt Capacitors router

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if let d = capacitorNotificationDelegate,
           d.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
            d.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
        } else {
            completionHandler([])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            openExternalUrl(from: response.notification.request.content.userInfo)
        }
        if let d = capacitorNotificationDelegate,
           d.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
            d.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
        } else {
            completionHandler()
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Headern som glider NER efter scroll: WKWebView lägger automatiskt på
        // top-contentInset för safe-area (default .automatic) OVANPÅ vår CSS
        // padding-top: env(safe-area-inset-top) → dubbel topp efter första scroll.
        // .never = stäng av auto-inseten, vår CSS sköter notchen. Nollar även bounce.
        // CSS/JS kan INTE röra detta (native scrollView). Walka från windows.
        func killBounce(_ v: UIView) {
            if let sv = v as? UIScrollView { sv.contentInsetAdjustmentBehavior = .never; sv.bounces = false; sv.alwaysBounceVertical = false }
            v.subviews.forEach(killBounce)
        }
        application.windows.forEach(killBounce)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { application.windows.forEach(killBounce) }
        installNotificationInterceptor()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
