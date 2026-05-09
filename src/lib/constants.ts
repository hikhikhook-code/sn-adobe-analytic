import {
  Search,
  LayoutDashboard,
  Users,
  Map,
  Heart,
  TrendingUp,
  FileDown,
  Settings,
  Upload,
  type LucideIcon,
} from "lucide-react";

export const APP_NAME = "SN Adobe Analytic";
export const APP_TAGLINE = "Analytics & insights for Adobe Stock contributors";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Search", href: "/search", icon: Search },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Portfolio Tracker", href: "/portfolio", icon: Users },
  { label: "Heat Map", href: "/heatmap", icon: Map },
  { label: "Trending", href: "/trending", icon: TrendingUp },
  { label: "Saved", href: "/saved", icon: Heart },
  { label: "Import data", href: "/import", icon: Upload },
  { label: "Export", href: "/export", icon: FileDown },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings },
];

export const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "featured", label: "Featured" },
  { value: "most_downloaded", label: "Most Downloaded" },
  { value: "undiscovered", label: "Undiscovered" },
] as const;

export const CONTENT_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "photo", label: "Photo" },
  { value: "illustration", label: "Illustration" },
  { value: "vector", label: "Vector" },
  { value: "video", label: "Video" },
  { value: "template", label: "Template" },
  { value: "3d", label: "3D" },
] as const;

export const AI_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "ai_only", label: "AI Only" },
  { value: "exclude_ai", label: "Exclude AI" },
] as const;

export const RESULTS_PER_PAGE = 30;
