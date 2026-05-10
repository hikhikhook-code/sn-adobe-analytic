# PRD — SN Adobe Analytic

> Product Requirements Document  
> Version: 1.0  
> Date: 9 Mei 2026  
> Status: Draft — Menunggu Approval

---

## 1. Ringkasan Produk

**SN Adobe Analytic** adalah platform analytics pihak ketiga untuk kontributor Adobe Stock. Tool ini memungkinkan user untuk menganalisis performa aset di Adobe Stock — melihat jumlah download nyata, menganalisis keyword trending, melacak kompetitor, dan menemukan niche yang paling laku.

### 1.1 Visi
Mulai sebagai tool pribadi, berkembang menjadi SaaS yang bisa dijual ke kontributor Adobe Stock lainnya.

### 1.2 Target User
- Kontributor Adobe Stock (fotografer, illustrator, videografer)
- Agency yang mengelola portfolio stock
- Researcher yang ingin analisis pasar stock image

### 1.3 Referensi Kompetitor
- [TAS Tracker](https://tastracker.com) — kompetitor utama yang menjadi acuan fitur
- Stock Insight (getstockinsight.com)

---

## 2. Tech Stack

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| **Framework** | Next.js 14+ (App Router) | SSR, API routes built-in, React Server Components |
| **Language** | TypeScript | Type safety |
| **CSS** | Tailwind CSS | Utility-first, cepat prototyping |
| **UI Components** | Shadcn/UI | Customizable, accessible, cocok sama Tailwind |
| **Auth** | NextAuth.js (Auth.js v5) | Google OAuth + Email/Password |
| **Database** | PostgreSQL (Supabase) | Free tier, realtime, built-in auth backup |
| **ORM** | Prisma | Type-safe database access |
| **Scraping** | Cheerio + Axios / Puppeteer | Data aggregation dari Adobe Stock |
| **Payment** | Stripe + PayPal | Untuk SaaS nanti |
| **Hosting** | Vercel | Gratis, optimized untuk Next.js |
| **CDN** | Cloudflare (opsional) | Bot protection, caching |
| **Analytics** | Vercel Analytics / PostHog | User behavior tracking |

---

## 3. Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                            │
│  Next.js App Router (React Server Components)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │  Search   │ │Portfolio │ │ Heat Map │ │Dashboard │   │
│  │  Page     │ │ Tracker  │ │  Page    │ │  Page    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
├─────────────────────────────────────────────────────────┤
│                    API LAYER                             │
│  Next.js Route Handlers (/api/*)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ /api/     │ │ /api/    │ │ /api/    │ │ /api/    │   │
│  │ search    │ │ user     │ │ export   │ │ contrib  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
├─────────────────────────────────────────────────────────┤
│                  DATA LAYER                              │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │ Prisma   │ │ Adobe Stock  │ │ Cache Layer      │    │
│  │ ORM      │ │ Scraper      │ │ (Redis/Memory)   │    │
│  └────┬─────┘ └──────────────┘ └──────────────────┘    │
│       │                                                  │
│  ┌────▼─────────────────────────────────────────────┐   │
│  │          PostgreSQL (Supabase)                     │   │
│  │  Users, Searches, Favorites, Plans, Assets Cache   │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 4. UI/UX Design

### 4.1 Design System — Referensi Visual

UI mengadopsi style dashboard modern dari referensi berikut:

![UI Reference](https://app.devin.ai/attachments/d8612bca-cf95-4edb-af61-1bf7eb02aec9/image.png)

### 4.2 Design Principles

| Aspek | Spesifikasi |
|-------|-------------|
| **Layout** | Sidebar kiri (fixed, dark navy `#1B2559`) + Main content area |
| **Background** | Light lavender/soft blue (`#F0F2FA`) |
| **Cards** | White (`#FFFFFF`), rounded-xl, shadow-sm |
| **Primary Color** | Deep Blue (`#1B2559`) untuk sidebar, `#3B82F6` untuk accent |
| **Accent Colors** | Orange `#F97316`, Teal `#14B8A6`, Purple `#8B5CF6`, Red `#EF4444` |
| **Typography** | Inter atau Geist Sans, clean, readable |
| **Icons** | Lucide Icons (built-in Shadcn/UI) |
| **Responsive** | Desktop-first, sidebar collapse di mobile |
| **Avatar** | Profile photo di atas sidebar |

### 4.3 Layout Structure

```
┌──────────────────────────────────────────────────────┐
│ ┌────────┐ ┌──────────────────────┐ ┌─────────────┐ │
│ │        │ │                      │ │             │ │
│ │  SIDE  │ │    MAIN CONTENT      │ │   RIGHT     │ │
│ │  BAR   │ │                      │ │   PANEL     │ │
│ │ (dark) │ │  (white cards on     │ │  (optional) │ │
│ │        │ │   lavender bg)       │ │             │ │
│ │ - Logo │ │                      │ │ - Stats     │ │
│ │ - Nav  │ │                      │ │ - Quick     │ │
│ │ - Menu │ │                      │ │   actions   │ │
│ │        │ │                      │ │             │ │
│ └────────┘ └──────────────────────┘ └─────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 4.4 Sidebar Navigation Items

| Icon | Label | Route | Keterangan |
|------|-------|-------|------------|
| Search | **Search** | `/search` | Halaman utama pencarian keyword |
| BarChart3 | **Dashboard** | `/dashboard` | Overview analytics pribadi |
| Users | **Portfolio Tracker** | `/portfolio` | Lacak kontributor |
| Map | **Heat Map** | `/heatmap` | Visualisasi niche/kompetisi |
| Heart | **Saved** | `/saved` | Favorites / saved searches |
| TrendingUp | **Trending** | `/trending` | Keyword & niche trending |
| FileDown | **Export** | `/export` | History export CSV |
| --- | --- | --- | --- |
| Settings | **Settings** | `/settings` | Pengaturan akun |
| LogOut | **Log Out** | — | Sign out |

---

## 5. Fitur Detail

### 5.1 Search (Halaman Utama)

**Route:** `/search`

**Komponen UI:**
1. **Search Bar** — Input keyword + tombol "Search" (blue) + "Search by Image" + "Saved"
2. **Filters Row:**
   - Sort By: Relevance, Newest, Featured, Most Downloaded, Undiscovered
   - Content Type: All Types, Photo, Illustration, Vector, Video, Template, 3D
   - Generative AI: All, AI Only, Exclude AI
3. **Recent Searches** — Chip tags dari pencarian terakhir, bisa di-clear
4. **Results Summary Bar:**
   - Total results count (contoh: "105,978,979 results for 'business'")
   - Competition level indicator (Low/Medium/High)
   - Content breakdown chart
   - AI saturation percentage
5. **Results Grid (3 kolom):**
   - Image thumbnail dengan badge PREMIUM jika applicable
   - Favorite/heart button di sudut kanan atas
   - Title section (dengan "Show All" toggle + copy button)
   - **Download Count** — angka besar dengan gradient card (blue-cyan)
   - **Performance Score** — X/100 dengan gradient card (orange-red), termasuk ~XD/MO (downloads per month)
   - Category tags (contoh: "Business", "Photo")
   - Upload Date (contoh: "21 Sept 2018 (7 years ago)")
   - View Portfolio link (nama contributor)
   - Find Similar Images button
   - Keywords section (expandable, semua keyword + copy all)
6. **Results Toolbar:**
   - "100 Results" counter
   - Sort: Default Results / By Downloads / By Performance
   - Filter: All Types
   - Select All button
   - **Export All (100)** button — download CSV
7. **Pagination:** Previous / Page X / Go / Next

**Backend Logic:**
```
POST /api/search
Body: { keyword, sort, contentType, aiFilter, page }
Response: {
  totalResults: number,
  competitionLevel: "low" | "medium" | "high",
  aiSaturation: number,
  results: [{
    id: string,
    thumbnailUrl: string,
    title: string,
    downloads: number,
    performanceScore: number,
    downloadsPerMonth: number,
    categories: string[],
    contentType: string,
    uploadDate: string,
    contributorName: string,
    contributorId: string,
    isPremium: boolean,
    isAiGenerated: boolean,
    keywords: string[]
  }]
}
```

**Data Source:**
- Scrape Adobe Stock search results (https://stock.adobe.com/search?k=...)
- Parse halaman publik untuk download count, contributor info, keywords
- Cache hasil scraping di database (TTL: 24 jam)

---

### 5.2 Portfolio Tracker

**Route:** `/portfolio`

**Fitur:**
1. Input contributor name atau URL
2. **Portfolio Overview:**
   - Total assets count
   - Total estimated downloads
   - Average downloads per asset
   - Best performing asset
   - Portfolio age
3. **Assets Grid** — semua aset dari contributor dengan download count & performance
4. **Best Sellers** — top 10 aset contributor by downloads
5. **Content Breakdown** — pie chart: Photo vs Vector vs Video vs Illustration
6. **Monthly Trends** — line chart performance over time
7. **Keyword Analysis** — most used keywords oleh contributor
8. **Compare Contributors** — side-by-side comparison

**Backend Logic:**
```
POST /api/portfolio
Body: { contributorName | contributorUrl }
Response: {
  contributor: { name, id, totalAssets, joinDate },
  stats: { totalDownloads, avgDownloads, topAsset },
  assets: [...],
  keywordFrequency: { keyword: count }
}
```

---

### 5.3 Heat Map

**Route:** `/heatmap`

**Fitur:**
1. **Niche Heat Map** — visual grid/treemap yang menunjukkan:
   - Keyword/niche mana yang paling banyak downloads
   - Warna berdasarkan competition level (hijau = rendah, merah = tinggi)
   - Size berdasarkan volume downloads
2. **Filters:**
   - Content Type
   - Time Period (last 7 days, 30 days, 90 days, 1 year)
   - Minimum downloads
3. **Niche Detail** — klik niche untuk lihat top performing images di niche itu
4. **Opportunity Finder** — niche dengan demand tinggi tapi supply/competition rendah

**Backend Logic:**
```
GET /api/heatmap
Query: { contentType, period, minDownloads }
Response: {
  niches: [{
    keyword: string,
    totalDownloads: number,
    totalAssets: number,
    competitionLevel: number,
    avgPerformance: number,
    trend: "up" | "down" | "stable"
  }]
}
```

---

### 5.4 Dashboard

**Route:** `/dashboard`

**Fitur (Right Panel style dari referensi UI):**
1. **Quick Stats Cards** (colorful, seperti Categories di referensi):
   - Total Searches Today (icon: Search, warna: red/orange)
   - Saved Assets (icon: Heart, warna: teal)
   - Exports Made (icon: Download, warna: blue)
   - Tracked Contributors (icon: Users, warna: dark blue)
2. **Recent Searches** — list 10 pencarian terakhir
3. **Saved Assets Preview** — grid 6 thumbnail favorit terbaru
4. **Search Usage** — progress bar (X / limit searches per hari, sesuai plan)
5. **Trending Keywords** — top 10 keyword trending hari ini
6. **Quick Actions:**
   - New Search
   - Track Contributor
   - Export Last Results

---

### 5.5 Similar Image Search

**Route:** Terintegrasi di `/search`

**Fitur:**
1. Upload image atau paste URL
2. Sistem cari image serupa di Adobe Stock
3. Tampilkan results dengan download count & performance
4. Bantu contributor lihat kompetisi visual mereka

**Backend Logic:**
```
POST /api/search/similar
Body: { imageUrl | imageFile (base64) }
Response: { results: [...] } // sama format dengan search results
```

---

### 5.6 Export CSV

**Trigger:** Tombol "Export All" di search results / portfolio

**Format CSV:**
```csv
ID,Title,Downloads,Performance Score,Downloads/Month,Content Type,Categories,Upload Date,Contributor,Keywords,Adobe Stock URL,Is Premium,Is AI
```

**Backend Logic:**
```
POST /api/export
Body: { searchId | results[] }
Response: CSV file download
```

---

### 5.7 Saved / Favorites

**Route:** `/saved`

**Fitur:**
1. Save individual images (heart button)
2. Save entire searches
3. Organize in collections/folders
4. Quick re-search from saved keywords
5. Track changes (download count delta sejak terakhir save)

---

### 5.8 Trending

**Route:** `/trending`

**Fitur:**
1. **Trending Keywords** — keyword dengan pertumbuhan search volume tertinggi
2. **Rising Niches** — niche baru yang mulai banyak demand
3. **Top Performers This Week** — image dengan download terbanyak minggu ini
4. **Seasonal Trends** — prediksi keyword berdasarkan seasonal pattern

---

## 6. Authentication & User System

### 6.1 Auth Methods
- **Email + Password** (credentials provider)
- **Google OAuth** (one-click sign in)

### 6.2 Auth Flow
```
Register → Email Verification → Login → Dashboard
           ↓
Forgot Password → Reset Email → New Password
```

### 6.3 Auth Pages

| Page | Route | Deskripsi |
|------|-------|-----------|
| Login | `/auth/login` | Email + password + Google sign-in |
| Register | `/auth/register` | Buat akun baru |
| Forgot Password | `/auth/forgot-password` | Request reset password |
| Reset Password | `/auth/reset-password` | Set password baru |
| Device Limit | `/auth/device-limit` | Notifikasi kalau device limit tercapai |

### 6.4 User Profile Fields
```typescript
interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  plan: "free" | "starter" | "pro" | "annual";
  searchesUsedToday: number;
  devicesCount: number;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 7. Pricing & Plans (Untuk SaaS Nanti)

| Feature | Free | Starter ($3/mo) | Pro ($8/mo) | Annual ($67/yr) |
|---------|------|------------------|-------------|-----------------|
| Searches/day | 2 | 50 | Unlimited | Unlimited |
| Similar Image Search | - | Ya | Ya | Ya |
| Upload Image Search | - | Ya | Ya | Ya |
| Export CSV | - | Ya | Ya | Ya |
| Save & Track Favorites | - | Ya | Ya | Ya |
| Performance Analytics | - | - | Ya | Ya |
| Portfolio Tracker | - | - | Ya | Ya |
| Heat Map | - | - | Ya | Ya |
| Trending Insights | - | - | Ya | Ya |
| Device Limit | 1 | 1 | 3 | 5 |
| Support | Community | Community | Priority | Priority |

**Payment Methods:**
- Stripe (kartu kredit/debit)
- PayPal
- Crypto (Cryptomus — USDT)

---

## 8. Database Schema

```prisma
// schema.prisma

model User {
  id              String    @id @default(cuid())
  name            String?
  email           String    @unique
  emailVerified   DateTime?
  hashedPassword  String?
  image           String?
  plan            Plan      @default(FREE)
  searchesUsedToday Int     @default(0)
  searchResetAt   DateTime  @default(now())
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  accounts        Account[]
  sessions        Session[]
  devices         Device[]
  searches        SearchHistory[]
  favorites       Favorite[]
  exports         ExportHistory[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Device {
  id         String   @id @default(cuid())
  userId     String
  deviceName String
  deviceId   String   @unique
  lastActive DateTime @default(now())
  isActive   Boolean  @default(true)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model SearchHistory {
  id        String   @id @default(cuid())
  userId    String
  keyword   String
  sort      String   @default("relevance")
  contentType String @default("all")
  aiFilter  String   @default("all")
  resultCount Int?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Favorite {
  id           String   @id @default(cuid())
  userId       String
  assetId      String
  thumbnailUrl String
  title        String
  downloads    Int
  performanceScore Int
  contributorName  String?
  keywords     String[] // array
  savedAt      DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, assetId])
}

model CachedAsset {
  id              String   @id @default(cuid())
  adobeStockId    String   @unique
  thumbnailUrl    String
  title           String
  downloads       Int
  performanceScore Int
  downloadsPerMonth Float
  categories      String[]
  contentType     String
  uploadDate      DateTime
  contributorName String
  contributorId   String
  isPremium       Boolean  @default(false)
  isAiGenerated   Boolean  @default(false)
  keywords        String[]
  lastScrapedAt   DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model CachedSearch {
  id          String   @id @default(cuid())
  keyword     String
  sort        String
  contentType String
  aiFilter    String
  page        Int      @default(1)
  totalResults Int
  resultIds   String[] // array of CachedAsset IDs
  competitionLevel String?
  aiSaturation Float?
  scrapedAt   DateTime @default(now())

  @@unique([keyword, sort, contentType, aiFilter, page])
}

model ExportHistory {
  id        String   @id @default(cuid())
  userId    String
  type      String   // "search" | "portfolio"
  query     String   // keyword or contributor name
  rowCount  Int
  fileUrl   String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum Plan {
  FREE
  STARTER
  PRO
  ANNUAL
}
```

---

## 9. API Endpoints

### 9.1 Auth
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/auth/signin/credentials` | Login email/password |
| POST | `/api/auth/signin/google` | Google OAuth |
| GET | `/api/auth/session` | Get session info |
| POST | `/api/auth/register` | Register user baru |
| POST | `/api/auth/forgot-password` | Kirim reset email |
| POST | `/api/auth/reset-password` | Set password baru |
| POST | `/api/auth/check-device-limit` | Cek batas device |
| POST | `/api/auth/log-login` | Log login activity |

### 9.2 User
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/user/me` | Get user profile |
| PATCH | `/api/user/me` | Update profile |
| GET | `/api/user/plan` | Get current plan |
| GET | `/api/user/device` | Get devices |
| POST | `/api/user/device/validate` | Validate device |
| POST | `/api/user/logout` | Logout + invalidate |

### 9.3 Search
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/search` | Search Adobe Stock |
| POST | `/api/search/similar` | Find similar images |
| GET | `/api/search/history` | Get search history |
| GET | `/api/search/trending` | Get trending keywords |

### 9.4 Portfolio
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/portfolio` | Analyze contributor |
| GET | `/api/portfolio/:id` | Get cached portfolio |

### 9.5 Data
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/heatmap` | Get niche heatmap data |
| POST | `/api/export` | Generate CSV export |
| GET | `/api/favorites` | Get saved favorites |
| POST | `/api/favorites` | Add favorite |
| DELETE | `/api/favorites/:id` | Remove favorite |

### 9.6 Payment (SaaS)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/checkout/stripe` | Create Stripe checkout |
| POST | `/api/checkout/paypal` | Create PayPal order |
| POST | `/api/checkout/crypto` | Create Cryptomus invoice |
| POST | `/api/webhook/stripe` | Stripe webhook handler |
| POST | `/api/webhook/paypal` | PayPal webhook handler |

---

## 10. Adobe Stock Data Scraping Strategy

### 10.1 Data Sources
1. **Search Results Page:** `https://stock.adobe.com/search?k={keyword}&filters[content_type:photo]=1`
   - Thumbnail URL, title, asset ID
2. **Asset Detail Page:** `https://stock.adobe.com/{assetId}`
   - Full title, keywords, upload date, contributor, content type, premium status
3. **Download Count:** Di-extract dari halaman publik atau API internal Adobe Stock
4. **Contributor Page:** `https://stock.adobe.com/contributor/{contributorId}`
   - Portfolio assets list, contributor info

### 10.2 Scraping Rules
- **Rate Limiting:** Max 1 request/detik ke Adobe Stock
- **User-Agent Rotation:** Rotate user agent strings
- **Proxy Rotation:** Gunakan proxy pool kalau perlu
- **Cache First:** Selalu cek cache sebelum scrape
- **TTL:** Cache 24 jam untuk search results, 7 hari untuk asset details
- **Retry Logic:** 3x retry dengan exponential backoff
- **Respect robots.txt:** Jangan scrape halaman yang di-disallow

### 10.3 Performance Score Calculation
```typescript
function calculatePerformanceScore(downloads: number, uploadDate: Date): number {
  const monthsSinceUpload = monthsDiff(uploadDate, new Date());
  const downloadsPerMonth = monthsSinceUpload > 0 ? downloads / monthsSinceUpload : downloads;

  // Score 0-100 based on downloads per month relative to category average
  if (downloadsPerMonth >= 100) return 100;
  if (downloadsPerMonth >= 50) return Math.round(80 + (downloadsPerMonth - 50) * 0.4);
  if (downloadsPerMonth >= 20) return Math.round(60 + (downloadsPerMonth - 20) * 0.67);
  if (downloadsPerMonth >= 5) return Math.round(30 + (downloadsPerMonth - 5) * 2);
  if (downloadsPerMonth >= 1) return Math.round(10 + (downloadsPerMonth - 1) * 5);
  return Math.round(downloadsPerMonth * 10);
}
```

### 10.4 Competition Level Calculation
```typescript
function calculateCompetitionLevel(totalResults: number): "low" | "medium" | "high" {
  if (totalResults < 10_000) return "low";
  if (totalResults < 100_000) return "medium";
  return "high";
}
```

---

## 11. Folder Structure

```
sn-adobe-analytic/
├── prisma/
│   └── schema.prisma
├── public/
│   ├── icon.png
│   ├── favicon.ico
│   └── manifest.json
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (sidebar + main area)
│   │   ├── page.tsx                # Redirect ke /search
│   │   ├── loading.tsx             # Global loading state
│   │   ├── (auth)/
│   │   │   ├── auth/
│   │   │   │   ├── login/page.tsx
│   │   │   │   ├── register/page.tsx
│   │   │   │   ├── forgot-password/page.tsx
│   │   │   │   └── reset-password/page.tsx
│   │   │   └── layout.tsx          # Auth layout (tanpa sidebar)
│   │   ├── (dashboard)/
│   │   │   ├── search/page.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── portfolio/page.tsx
│   │   │   ├── heatmap/page.tsx
│   │   │   ├── saved/page.tsx
│   │   │   ├── trending/page.tsx
│   │   │   ├── export/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   ├── pricing/page.tsx
│   │   │   └── layout.tsx          # Dashboard layout (dengan sidebar)
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── search/route.ts
│   │       ├── search/similar/route.ts
│   │       ├── search/trending/route.ts
│   │       ├── portfolio/route.ts
│   │       ├── heatmap/route.ts
│   │       ├── export/route.ts
│   │       ├── favorites/route.ts
│   │       ├── user/route.ts
│   │       ├── checkout/stripe/route.ts
│   │       └── webhook/stripe/route.ts
│   ├── components/
│   │   ├── ui/                     # Shadcn/UI components
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── RightPanel.tsx
│   │   ├── search/
│   │   │   ├── SearchBar.tsx
│   │   │   ├── SearchFilters.tsx
│   │   │   ├── ResultsGrid.tsx
│   │   │   ├── ResultCard.tsx
│   │   │   ├── ResultsToolbar.tsx
│   │   │   └── Pagination.tsx
│   │   ├── portfolio/
│   │   │   ├── ContributorSearch.tsx
│   │   │   ├── PortfolioOverview.tsx
│   │   │   └── AssetGrid.tsx
│   │   ├── heatmap/
│   │   │   └── NicheHeatMap.tsx
│   │   ├── dashboard/
│   │   │   ├── StatsCards.tsx
│   │   │   ├── RecentSearches.tsx
│   │   │   └── TrendingKeywords.tsx
│   │   └── auth/
│   │       ├── LoginForm.tsx
│   │       ├── RegisterForm.tsx
│   │       └── GoogleButton.tsx
│   ├── lib/
│   │   ├── prisma.ts               # Prisma client singleton
│   │   ├── auth.ts                 # NextAuth config
│   │   ├── scraper/
│   │   │   ├── adobeStock.ts       # Adobe Stock scraper
│   │   │   ├── parser.ts           # HTML parser
│   │   │   └── cache.ts            # Cache layer
│   │   ├── utils.ts                # Utility functions
│   │   └── constants.ts            # App constants
│   ├── hooks/
│   │   ├── useSearch.ts
│   │   ├── useFavorites.ts
│   │   └── useUser.ts
│   └── types/
│       ├── search.ts
│       ├── user.ts
│       └── portfolio.ts
├── .env.local
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## 12. Environment Variables

```env
# Database
DATABASE_URL="postgresql://..."

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"

# Google OAuth
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# Stripe (SaaS)
STRIPE_SECRET_KEY="..."
STRIPE_WEBHOOK_SECRET="..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="..."

# PayPal (SaaS)
PAYPAL_CLIENT_ID="..."
PAYPAL_CLIENT_SECRET="..."

# Supabase
NEXT_PUBLIC_SUPABASE_URL="..."
SUPABASE_SERVICE_ROLE_KEY="..."

# Scraping
PROXY_URL="..." # optional
SCRAPE_RATE_LIMIT_MS=1000
```

---

## 13. Development Phases

### Phase 1 — Core MVP (Week 1-2)
- [ ] Setup Next.js + Tailwind + Shadcn/UI
- [ ] UI Layout: Sidebar (dark navy) + Main content area
- [ ] Search page: search bar, filters, results grid
- [ ] Adobe Stock scraping logic (basic keyword search)
- [ ] Result cards: thumbnail, title, downloads, performance score, keywords
- [ ] Basic auth (NextAuth.js: email/password + Google)
- [ ] Database setup (Prisma + Supabase PostgreSQL)
- [ ] Deploy ke Vercel

### Phase 2 — Features (Week 3-4)
- [ ] Portfolio Tracker (contributor analysis)
- [ ] Favorites / Saved system
- [ ] Export CSV
- [ ] Search history
- [ ] Recent searches
- [ ] Pagination

### Phase 3 — Advanced (Week 5-6)
- [ ] Heat Map (niche visualization)
- [ ] Trending keywords
- [ ] Similar Image Search
- [ ] Dashboard with stats
- [ ] Performance analytics
- [ ] Device limit system

### Phase 4 — SaaS (Week 7-8)
- [ ] Pricing page
- [ ] Stripe integration
- [ ] PayPal integration
- [ ] Plan-based feature gating
- [ ] Admin panel (user management)
- [ ] Landing page

---

## 14. Non-Functional Requirements

| Requirement | Target |
|------------|--------|
| Page Load Time | < 2 detik (LCP) |
| Search Response | < 3 detik (termasuk scraping) |
| Cache Hit Rate | > 70% search queries |
| Uptime | 99.5% |
| Mobile Responsive | Ya |
| SEO | Schema.org, Open Graph, Sitemap |
| Security | CSRF, rate limiting, input sanitization |
| Browser Support | Chrome, Firefox, Safari, Edge (modern) |

---

## 15. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Adobe Stock blocking scraper | Data tidak tersedia | Proxy rotation, rate limiting, user-agent spoofing |
| Adobe Stock mengubah HTML structure | Parser rusak | Monitoring, fallback parser, alert system |
| Supabase free tier limit | Database penuh | Pruning data lama, upgrade kalau perlu |
| Vercel free tier limit | Serverless timeout | Optimize scraping, queue system |
| Legal issue scraping | Takedown notice | Hanya scrape data publik, comply dengan robots.txt |

---

## Approval

> **Status:** Menunggu review & approval sebelum mulai development  
> **Next Step:** Setelah approved, mulai Phase 1 — Setup project + core search

---

*Dokumen ini dibuat berdasarkan reverse-engineering TAS Tracker (tastracker.com) dan input dari stakeholder.*
