# Tamil Fonts Guide

## Overview

This project uses **Google Fonts** for Tamil typography, providing professional, web-optimized fonts that render beautifully across all devices.

## Available Tamil Fonts

### 1. **Noto Sans Tamil** (Primary Font)
**Class:** `font-tamil`
**Variable:** `--font-tamil`
**Type:** Sans-serif
**Weights:** 400 (Regular), 500 (Medium), 600 (Semi-Bold), 700 (Bold)

**Best for:**
- Body text and paragraphs
- UI elements (buttons, forms, menus)
- General content display
- High readability across all sizes

**Usage Example:**
```tsx
<p className="font-tamil">
  தமிழ் இலக்கியத்தின் எல்லையற்ற உலகம்
</p>
```

**Characteristics:**
- Clean, modern sans-serif design
- Excellent screen readability
- Professional appearance
- Wide character support
- Optimized for digital displays

---

### 2. **Kavivanar** (Display/Decorative Font)
**Class:** `font-kavivanar`
**Variable:** `--font-kavivanar`
**Type:** Cursive/Handwritten
**Weights:** 400 (Regular)

**Best for:**
- Logo text and branding
- Headlines and titles
- Decorative elements
- Poetic content
- Emotional/artistic content

**Usage Example:**
```tsx
<h1 className="font-kavivanar">
  தமிழகவல்
</h1>
```

**Characteristics:**
- Handwritten, flowing style
- Artistic and elegant
- Great for short text
- Adds personality
- Not suitable for long paragraphs

---

### 3. **Baloo Thambi 2** (Playful/Friendly Font)
**Class:** `font-poem`
**Variable:** `--font-baloo-thambi`
**Type:** Rounded sans-serif
**Weights:** 400 (Regular), 500 (Medium), 600 (Semi-Bold), 700 (Bold), 800 (Extra-Bold)

**Best for:**
- Poetry and creative writing
- Children's content
- Friendly, approachable tone
- Headings with personality
- Casual, warm atmosphere

**Usage Example:**
```tsx
<div className="font-poem">
  <h2>கவிதை</h2>
  <p>காற்றில் மிதந்து வந்த மலரே...</p>
</div>
```

**Characteristics:**
- Rounded, friendly appearance
- Playful and warm
- High readability
- Great for creative content
- Multiple weights available

---

## Font Implementation

### In Layout (src/app/layout.tsx)
```typescript
import { Noto_Sans_Tamil, Kavivanar, Baloo_Thambi_2 } from "next/font/google";

const notoSansTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-tamil',
});

const kavivanar = Kavivanar({
  subsets: ['tamil'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-kavivanar',
});

const balooThambi = Baloo_Thambi_2({
  subsets: ['tamil'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-baloo-thambi',
});
```

### In Tailwind Config (tailwind.config.ts)
```typescript
fontFamily: {
  tamil: ['var(--font-tamil)', 'sans-serif'],
  kavivanar: ['var(--font-kavivanar)', 'cursive'],
  poem: ['var(--font-baloo-thambi)', 'var(--font-tamil)', 'sans-serif'],
}
```

---

## Font Usage Matrix

| Use Case | Recommended Font | Class | Weight |
|----------|------------------|-------|--------|
| **Body Text** | Noto Sans Tamil | `font-tamil` | 400 |
| **Bold Body** | Noto Sans Tamil | `font-tamil font-semibold` | 600 |
| **UI Elements** | Noto Sans Tamil | `font-tamil` | 400-700 |
| **Logo** | Kavivanar | `font-kavivanar` | 400 |
| **Main Headlines** | Noto Sans Tamil | `font-tamil font-extrabold` | 700 |
| **Poetry** | Baloo Thambi 2 | `font-poem` | 400-500 |
| **Decorative Titles** | Kavivanar | `font-kavivanar` | 400 |
| **Children's Content** | Baloo Thambi 2 | `font-poem` | 400-600 |
| **Buttons** | Noto Sans Tamil | `font-tamil font-bold` | 700 |
| **Form Labels** | Noto Sans Tamil | `font-tamil font-medium` | 500 |

---

## Typography Best Practices

### Line Height Recommendations

| Element Type | Line Height Class | Ratio | Use Case |
|-------------|------------------|-------|----------|
| Headlines (H1-H2) | `leading-snug` | 1.375 | Short display text |
| Subheadings (H3-H4) | `leading-snug` | 1.375 | Section headings |
| Body Text | `leading-relaxed` | 1.625 | Regular paragraphs |
| Tamil Paragraphs | `leading-loose` | 2.0 | Long-form Tamil content |
| UI Text | `leading-normal` | 1.5 | Buttons, labels, menus |

### Font Size Recommendations

| Element | Mobile | Tablet | Desktop | Class |
|---------|--------|--------|---------|-------|
| Hero H1 | 30px | 36px | 48px | `text-3xl sm:text-4xl lg:text-5xl` |
| Section H2 | 24px | 30px | 36px | `text-2xl sm:text-3xl lg:text-4xl` |
| Card H3 | 20px | 20px | 20px | `text-xl` |
| Body Text | 16px | 18px | 18px | `text-base sm:text-lg` |
| Small Text | 14px | 14px | 14px | `text-sm` |

---

## Current Usage in Project

### 1. **Landing Page (src/app/page.tsx)**
- **Logo:** `font-kavivanar` (Kavivanar)
- **Headlines:** `font-tamil font-extrabold` (Noto Sans Tamil Bold)
- **Body Text:** `font-tamil` (Noto Sans Tamil Regular)
- **Buttons:** `font-tamil font-bold` (Noto Sans Tamil Bold)

### 2. **Header (src/components/Header.tsx)**
- **Logo:** `font-kavivanar` (Kavivanar)
- **Navigation:** `font-tamil font-medium` (Noto Sans Tamil Medium)

### 3. **Admin Panel**
- **All UI:** `font-tamil` (Noto Sans Tamil)
- **Forms:** `font-tamil` (Noto Sans Tamil)

---

## Adding More Google Tamil Fonts (Optional)

If you need additional Tamil fonts, Google Fonts offers:

### Available but Not Implemented:
1. **Catamaran** - Modern geometric sans-serif
2. **Mukta Malar** - Clean, contemporary sans-serif
3. **Pavanam** - Humanist sans-serif
4. **Arima Madurai** - Display serif font
5. **Meera Inimai** - Traditional Tamil font
6. **Hind Madurai** - Clean, professional sans-serif

### How to Add a New Font:

1. **Update layout.tsx:**
```typescript
import { New_Tamil_Font } from "next/font/google";

const newTamilFont = New_Tamil_Font({
  subsets: ['tamil'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-new-tamil',
});
```

2. **Update tailwind.config.ts:**
```typescript
fontFamily: {
  'new-tamil': ['var(--font-new-tamil)', 'sans-serif'],
}
```

3. **Use in components:**
```tsx
<p className="font-new-tamil">தமிழ் வாசகம்</p>
```

---

## Font Loading Strategy

All fonts use `display: 'swap'` for optimal performance:
- **Immediate text rendering** with fallback font
- **Seamless swap** when Tamil font loads
- **No layout shift** (FOUT prevention)
- **Improved Core Web Vitals** (CLS, LCP)

---

## Testing Fonts

### View All Fonts:
Create a test page to see all fonts:

```tsx
export default function FontsTestPage() {
  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-sm text-gray-500">Noto Sans Tamil</h2>
        <p className="font-tamil text-4xl">தமிழகவல் - பாடல்கள், கவிதைகள்</p>
      </div>

      <div>
        <h2 className="text-sm text-gray-500">Kavivanar</h2>
        <p className="font-kavivanar text-4xl">தமிழகவல் - பாடல்கள், கவிதைகள்</p>
      </div>

      <div>
        <h2 className="text-sm text-gray-500">Baloo Thambi 2</h2>
        <p className="font-poem text-4xl">தமிழகவல் - பாடல்கள், கவிதைகள்</p>
      </div>
    </div>
  );
}
```

---

## Font Performance

### Optimization Features:
✅ **Subset loading** - Only Tamil characters
✅ **Font display swap** - No invisible text
✅ **Variable fonts** - Efficient loading
✅ **Preloading** - Faster initial render
✅ **CDN delivery** - Google Fonts CDN

### File Sizes (Approximate):
- Noto Sans Tamil: ~45KB (all weights)
- Kavivanar: ~25KB
- Baloo Thambi 2: ~55KB (all weights)

**Total:** ~125KB for all Tamil fonts

---

## Browser Support

All fonts are fully supported on:
- ✅ Chrome/Edge (Chromium) - Full support
- ✅ Firefox - Full support
- ✅ Safari (macOS/iOS) - Full support
- ✅ Samsung Internet - Full support
- ✅ Opera - Full support

Fallback: `sans-serif` system font for unsupported browsers

---

## Troubleshooting

### Font Not Loading?
1. Check browser console for errors
2. Verify font is imported in layout.tsx
3. Ensure Tailwind class is correct
4. Clear browser cache
5. Check network tab for font file downloads

### Font Looks Different?
- Different operating systems render fonts slightly differently
- Use `antialiased` class for smoother rendering
- Check font-weight matches imported weights

### Performance Issues?
- Fonts are lazy-loaded by default
- Use `display: 'swap'` (already configured)
- Preload critical fonts if needed
- Consider reducing number of font weights

---

## Quick Reference

```bash
# Current Font Classes
font-tamil          # Noto Sans Tamil (default)
font-kavivanar      # Kavivanar (decorative)
font-poem           # Baloo Thambi 2 (poetic)

# Font Weights
font-normal         # 400
font-medium         # 500
font-semibold       # 600
font-bold           # 700
font-extrabold      # 800 (Baloo Thambi only)

# Line Heights
leading-tight       # 1.25 (avoid for Tamil)
leading-snug        # 1.375 (headlines)
leading-normal      # 1.5 (UI text)
leading-relaxed     # 1.625 (body text)
leading-loose       # 2.0 (Tamil paragraphs)
```

---

## Resources

- [Google Fonts - Noto Sans Tamil](https://fonts.google.com/noto/specimen/Noto+Sans+Tamil)
- [Google Fonts - Kavivanar](https://fonts.google.com/specimen/Kavivanar)
- [Google Fonts - Baloo Thambi 2](https://fonts.google.com/specimen/Baloo+Thambi+2)
- [Next.js Font Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)
- [Tamil Typography Guidelines](https://www.w3.org/International/articles/typography/tamil.en)
