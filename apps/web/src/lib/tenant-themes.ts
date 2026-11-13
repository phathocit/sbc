import type { CSSProperties } from 'react';
import type { TenantThemeKey, TenantThemeMode } from '@sbc/contracts';

export const tenantThemes: Array<{
  key: TenantThemeKey;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
}> = [
  { key: 'blueberry-cream', name: 'Blueberry Cream', primary: '#6478D8', secondary: '#AAB8F5', accent: '#E8A8C8', background: '#F0F2FC', surface: '#FAFAFF' },
  { key: 'peach-soda', name: 'Peach Soda', primary: '#F28D78', secondary: '#F8C6A8', accent: '#A7C9BE', background: '#FFF3EE', surface: '#FFFAF7' },
  { key: 'matcha-latte', name: 'Matcha Latte', primary: '#79A987', secondary: '#B9D6AD', accent: '#E6C58B', background: '#F1F6ED', surface: '#FBFDF8' },
  { key: 'lavender-pop', name: 'Lavender Pop', primary: '#9779DB', secondary: '#C8B6F3', accent: '#F2B5D0', background: '#F5F0FF', surface: '#FCFAFF' },
  { key: 'strawberry-milk', name: 'Strawberry Milk', primary: '#E7789E', secondary: '#F4B5CA', accent: '#A5C5E8', background: '#FFF0F5', surface: '#FFFAFC' },
  { key: 'minty-fresh', name: 'Minty Fresh', primary: '#42B5A2', secondary: '#A3E1D1', accent: '#F5C49B', background: '#EAF9F5', surface: '#FAFFFC' },
  { key: 'coral-bloom', name: 'Coral Bloom', primary: '#EF797C', secondary: '#F6B5AD', accent: '#8AC8C2', background: '#FFF0EF', surface: '#FFFAF9' },
  { key: 'lemon-sorbet', name: 'Lemon Sorbet', primary: '#B99629', secondary: '#F3D98A', accent: '#94C7AE', background: '#FFF9E8', surface: '#FFFDF7' },
  { key: 'cotton-candy', name: 'Cotton Candy', primary: '#8A8CE5', secondary: '#C8C4FA', accent: '#F1A9BD', background: '#F4F2FF', surface: '#FCFBFF' },
];

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => parseInt(value, 16) / 255) ?? [0, 0, 0];
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function mix(first: string, second: string, secondWeight: number): string {
  const a = first.slice(1).match(/.{2}/g)?.map((value) => parseInt(value, 16)) ?? [0, 0, 0];
  const b = second.slice(1).match(/.{2}/g)?.map((value) => parseInt(value, 16)) ?? [0, 0, 0];
  return `#${a.map((value, index) => Math.round(value * (1 - secondWeight) + b[index] * secondWeight).toString(16).padStart(2, '0')).join('')}`;
}

function accessibleBrandText(primary: string, backgrounds: string[], mode: TenantThemeMode): string {
  const target = mode === 'dark' ? '#FFFFFF' : '#25283A';
  for (let step = 0; step <= 100; step += 2) {
    const candidate = mix(primary, target, step / 100);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= 4.5)) return candidate;
  }
  return target;
}

function darkTint(base: string, brand: string, amount: number): string {
  return mix(base, brand, amount);
}

export function tenantThemeStyle(themeKey: TenantThemeKey | null | undefined, mode: TenantThemeMode = 'light'): CSSProperties | undefined {
  const theme = tenantThemes.find((candidate) => candidate.key === themeKey) ?? (mode === 'dark' ? {
    key: 'matcha-latte' as TenantThemeKey, name: 'Default', primary: '#27745B', secondary: '#A3BBA8', accent: '#BF7959',
    background: '#F5F6F2', surface: '#FFFEFA',
  } : undefined);
  if (!theme) return undefined;
  const background = mode === 'dark' ? darkTint('#1D202A', theme.primary, 0.12) : theme.background;
  const surface = mode === 'dark' ? darkTint('#292D38', theme.primary, 0.15) : theme.surface;
  const onPrimary = contrastRatio('#FFFFFF', theme.primary) >= contrastRatio('#11131A', theme.primary) ? '#FFFFFF' : '#11131A';
  const primaryText = accessibleBrandText(theme.primary, [background, surface], mode);
  const primarySoft = mode === 'dark'
    ? mix(surface, theme.secondary, 0.2)
    : mix(surface, theme.secondary, 0.38);
  const line = mode === 'dark'
    ? mix(surface, theme.secondary, 0.3)
    : mix(surface, theme.primary, 0.2);
  return {
    '--tenant-theme-primary': theme.primary,
    '--tenant-theme-secondary': theme.secondary,
    '--tenant-theme-accent': theme.accent,
    '--tenant-theme-background': background,
    '--tenant-theme-surface': surface,
    '--tenant-theme-surface-soft': mode === 'dark' ? darkTint('#333746', theme.primary, 0.14) : mix(surface, theme.secondary, 0.18),
    '--tenant-theme-text': mode === 'dark' ? '#F3F1F8' : '#2D3040',
    '--tenant-theme-text-secondary': mode === 'dark' ? '#D0CCDA' : '#505568',
    '--tenant-theme-muted': mode === 'dark' ? '#B4B0BF' : '#626A7D',
    '--tenant-theme-primary-text': primaryText,
    '--tenant-theme-line': line,
    '--tenant-theme-line-strong': mode === 'dark' ? mix(surface, theme.secondary, 0.48) : mix(surface, theme.primary, 0.32),
    '--tenant-theme-accent-soft': primarySoft,
    '--tenant-theme-on-primary': onPrimary,
  } as CSSProperties;
}
