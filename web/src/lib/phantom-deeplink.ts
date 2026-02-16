/**
 * Phantom Deep Link Utilities
 * For mobile users not in Phantom's in-app browser
 */

export function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

export function isPhantomBrowser(): boolean {
  if (typeof window === "undefined") return false;
  // Check if we're in Phantom's in-app browser
  return !!(window as any).phantom?.solana?.isPhantom;
}

export function hasPhantomExtension(): boolean {
  if (typeof window === "undefined") return false;
  // Check if Phantom extension is installed (desktop)
  return typeof (window as any).solana !== "undefined" && (window as any).solana.isPhantom;
}

export function shouldShowPhantomDeepLink(): boolean {
  return isMobile() && !isPhantomBrowser() && !hasPhantomExtension();
}

export function getPhantomDeepLink(redirectUrl?: string): string {
  const url = redirectUrl || window.location.href;
  const encodedUrl = encodeURIComponent(url);
  return `https://phantom.app/ul/browse/${encodedUrl}?ref=${encodedUrl}`;
}

export function openInPhantom(): void {
  const deepLink = getPhantomDeepLink();
  window.location.href = deepLink;
}
