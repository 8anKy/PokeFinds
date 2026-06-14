# Databasschema

PostgreSQL via Prisma (`prisma/schema.prisma`). **Konvention: alla priser lagras i öre (integer)** — formatera med `formatPrice()` i `src/lib/format.ts`.

## Modeller

| Modell | Syfte | Viktiga relationer |
|---|---|---|
| User | Konto, roll (USER/MODERATOR/ADMIN/SUPERADMIN), plan (FREE/PREMIUM), notisinställningar (Json), preferenser | → allt användarägt |
| CardSet | TCG-set (namn, serie, releasedatum) | ← Card, Product |
| Card | Enskilt kort (namn, nummer, rarity, språk) — unik per (set, nummer, språk) | → CardSet; ← Product, CollectionItem |
| Product | Säljbar enhet (singles, booster box, ETB m.m.), slug, kategori | → Card?, CardSet?; ← Offer, priser, bevakningar |
| Retailer | Butik (land, aktiv, affiliate) | ← Offer, RestockEvent |
| Offer | Aktuellt erbjudande per butik (pris, frakt, lagerstatus) — unik per (produkt, butik, skick, språk) | → Product, Retailer |
| PriceObservation | Rå prisobservation med `rawData` (Json) från källan | → Product, ScrapeSource |
| PriceSnapshot | Daglig aggregering (min/max/snitt/volym) för snabba grafer — unik per (produkt, datum) | → Product |
| RestockEvent | Lagerändring (oldStatus → newStatus) med tidsstämpel | → Product, Retailer |
| WatchlistItem | Bevakning (målpris, maxpris, restock-/pris-alert, kanaler, pausad) — unik per (user, produkt) | → User, Product |
| Alert | Triggad alert (typ, kanal, status PENDING/SENT/FAILED/READ, retryCount) | → User, Product? |
| Notification | In-app-notis (läst/oläst) | → User |
| CollectionItem | Samlingsobjekt (antal, skick, inköpspris, värde, grading) | → User, Card?, Product? |
| CommunityPost / Comment / Like / SavedPost / Report | Community + moderering | → User, inbördes |
| ScrapeSource | Datakälla (typ, aktiv, config Json, lastRunAt) | ← ScrapeJob, PriceObservation |
| ScrapeJob | Jobbkörning (status, itemsFound/Updated, logs Json, fel) | → ScrapeSource |
| ScannerJob | Kortskanning (status, result Json, confidence) | → User |
| AuditLog | Adminåtgärder (action, entityType, metadata) | → User? |
| AnalyticsEvent | Anonymiserade händelser (product_view, retailer_click, search …) | – |

## Index-strategi
Index på sökfält (normalizedTitle, kategori), tidsserier (productId+observedAt / date), och status-fält (Alert.status, ScrapeJob.status, Report.status) för snabba dashboards.
