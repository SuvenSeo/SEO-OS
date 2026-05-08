# SEOS Platform: Quick Audit Summary & Priority Fixes

## TL;DR - Top 10 Issues to Fix First

### 🔴 CRITICAL (Do First)
1. **No focus visible states** - Users can't navigate with keyboard
2. **Missing aria-labels** - Icon buttons have no accessible names
3. **Mobile sidebar crushes layout** - Fixed sidebar breaks mobile UX
4. **No focus trap in modals** - Tab key escapes dialogs
5. **Animations don't respect prefers-reduced-motion** - WCAG violation
6. **Form errors not associated** - Users don't know which field has error
7. **Missing skip-to-main link** - Keyboard users must tab through nav
8. **No error handling feedback** - Users don't know when API calls fail

### 🟡 HIGH (Fix Next)
9. **Typography lacks text-balance/text-pretty** - Orphaned words look unprofessional
10. **Responsive padding too large on mobile** - Only 14px content on 375px phone

---

## Code Snippets: Critical Fixes

### Fix 1: Focus Visible States
```css
/* Add to globals.css */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

button:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

### Fix 2: Add aria-labels to Icon Buttons
```jsx
// Before
<button onClick={() => deleteTask(id)}>
  <TrashIcon />
</button>

// After
<button 
  onClick={() => deleteTask(id)}
  aria-label={`Delete task: ${task.title}`}
  title={`Delete task: ${task.title}`}
>
  <TrashIcon />
</button>
```

### Fix 3: Responsive Layout for Mobile
```jsx
// layout.js
export const metadata = {
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

<body className="min-h-full flex flex-col md:flex-row bg-[var(--bg-primary)]">
  {/* Hide sidebar on mobile */}
  <Sidebar className="hidden md:fixed md:flex md:flex-col md:w-64" />
  
  {/* Adjust main margin on desktop only */}
  <main className="flex-1 md:ml-64 min-h-screen">
    {/* Responsive padding: 4px mobile, 6px tablet, 8px desktop */}
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
      {children}
    </div>
  </main>
</body>
```

### Fix 4: Prefers Reduced Motion Support
```jsx
// Create a hook
export const useMotionConfig = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    
    const handler = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);
  
  return {
    spring: prefersReducedMotion 
      ? { type: 'tween', duration: 0 }
      : { type: 'spring', stiffness: 300, damping: 30 },
  };
};

// Usage
const motionConfig = useMotionConfig();
<motion.div transition={motionConfig.spring}>
  Content
</motion.div>
```

### Fix 5: Form Error Association
```jsx
// Create reusable FormField component
<div>
  <label htmlFor="task-title" className="text-sm font-medium">
    Title <span className="text-red-400">*</span>
  </label>
  
  <input
    id="task-title"
    type="text"
    required
    aria-required="true"
    aria-invalid={!!errors.title}
    aria-describedby={errors.title ? 'title-error' : undefined}
    className="w-full px-4 py-3 rounded-xl ..."
  />
  
  {errors.title && (
    <p id="title-error" role="alert" className="text-xs text-red-400 mt-1">
      {errors.title}
    </p>
  )}
</div>
```

### Fix 6: Skip-to-Main Link
```jsx
// Add to layout.js body
<body className="...">
  <a 
    href="#main-content"
    className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-[9999] focus:p-4 focus:bg-[var(--accent)] focus:text-white"
  >
    Skip to main content
  </a>
  
  <Sidebar />
  
  <main id="main-content" className="...">
    {children}
  </main>
</body>
```

### Fix 7: Text Wrapping (Typography)
```css
/* Add to globals.css */
h1, h2, h3 { 
  text-wrap: balance; 
}

p, body {
  text-wrap: pretty;
}
```

### Fix 8: Tabular Numbers (Data Display)
```jsx
// Dashboard stats
<p className="text-3xl font-bold tracking-[-0.04em]" style={{ fontVariantNumeric: 'tabular-nums' }}>
  {stat.value}
</p>

// Or use Tailwind if available:
<p className="text-3xl font-bold tracking-[-0.04em] tabular-nums">
  {stat.value}
</p>
```

### Fix 9: Font Smoothing
```css
/* Add to globals.css */
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body.antialiased {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### Fix 10: Error Handling with User Feedback
```jsx
// In your API hook or component
async function createTask(e) {
  e.preventDefault();
  
  if (!form.title.trim()) {
    setError('Title is required');
    return;
  }
  
  setLoading(true);
  setError(null);
  
  try {
    const response = await api.tasks.create({ ...form });
    // Success feedback
    setForm({ title: '', description: '', priority: 3, deadline: '' });
    setShowModal(false);
    showToast('Task created successfully', 'success');
    loadTasks();
  } catch (err) {
    // Error feedback
    const errorMessage = err.response?.data?.message || err.message || 'Failed to create task';
    setError(errorMessage);
    showToast(errorMessage, 'error');
    console.error('Create task error:', err);
  } finally {
    setLoading(false);
  }
}

// Toast component
<motion.div 
  initial={{ opacity: 0, y: -10 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -10 }}
  role="status"
  className={`px-4 py-3 rounded-xl text-sm font-medium ${
    type === 'error' 
      ? 'bg-red-500/15 text-red-400' 
      : 'bg-emerald-500/15 text-emerald-400'
  }`}
>
  {message}
</motion.div>
```

---

## Accessibility Compliance Checklist

### WCAG 2.2 Level AA (Required)

**Perceivable**
- [ ] All images have alt text (or alt="")
- [ ] Color contrast ≥ 4.5:1 for text
- [ ] Color not sole indicator of meaning
- [ ] Font size ≥ 16px body text

**Operable**
- [ ] All interactive elements keyboard accessible
- [ ] Focus visible (≥ 3px indicator)
- [ ] Touch targets ≥ 44×44px
- [ ] No keyboard traps
- [ ] Skip links present

**Understandable**
- [ ] Headings in logical order (h1→h2→h3)
- [ ] Form labels associated with inputs
- [ ] Required fields announced
- [ ] Error messages clear & specific
- [ ] Consistent navigation

**Robust**
- [ ] Semantic HTML (not div-button hacks)
- [ ] ARIA labels on icon-only buttons
- [ ] Modal focus trapped
- [ ] Reduced-motion respected

---

## Performance Audit Targets

| Metric | Current | Target |
|--------|---------|--------|
| First Contentful Paint | ? | <1.5s |
| Largest Contentful Paint | ? | <2.5s |
| Cumulative Layout Shift | ? | <0.1 |
| Time to Interactive | ? | <3.5s |
| Animation Frame Rate | 60fps (spring) | 60fps |

---

## Visual Consistency Checklist

### Colors
- [ ] Test all text on all backgrounds for 4.5:1 contrast
- [ ] Verify accent color consistent across all pages
- [ ] Check success/warning/error colors tested
- [ ] Ensure dark mode applies everywhere

### Spacing
- [ ] Use 4px, 8px, 16px, 24px, 32px (multiples of 4)
- [ ] Gap consistency: gap-4 or gap-6 (no random values)
- [ ] Padding consistency: p-4, p-6, p-8 (not p-5, p-7)
- [ ] Margin: use space-y-* (not m-*)

### Typography
- [ ] All headings use text-balance
- [ ] All body text uses text-pretty
- [ ] Body text font size ≥ 16px
- [ ] Tabular numbers on all data
- [ ] Line height ≥ 1.5

### Animation
- [ ] All animations ≤ 200ms
- [ ] Easing: ease-out entrance, ease-in exit
- [ ] Hover/tap: scale 1.02 / 0.98
- [ ] Reduced motion: no animations
- [ ] No animating layout properties

### Responsiveness
- [ ] Test 375px, 768px, 1024px, 1920px
- [ ] Sidebar hidden on mobile
- [ ] Padding responsive: 16px mobile, 32px desktop
- [ ] Typography responsive: text-2xl mobile, text-3xl desktop
- [ ] No horizontal scroll

---

## Files to Update (Priority Order)

1. **globals.css** - Add text-wrap, font-smoothing, focus styles
2. **layout.js** - Add viewport meta, responsive layout, skip link
3. **Sidebar.js** - Add aria-labels to icons, responsive hiding
4. **Create Button component** - Reusable, accessible, consistent
5. **Create Input component** - With error association, ARIA
6. **Create Modal component** - With focus trap
7. **All page components** - Add motion config, reduce-motion support
8. **utils.js** - Add motion config hook

---

## Estimated Implementation Time

| Priority | Tasks | Time |
|----------|-------|------|
| 🔴 Critical | 8 fixes | 1 week |
| 🟡 High | 8 fixes | 1 week |
| 🟠 Medium | 15 fixes | 1 week |
| 🟢 Low | 10 fixes | 0.5 week |
| **Total** | **41 improvements** | **3-4 weeks** |

---

## Resources

- [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/WAI/WCAG22/quickref/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines)
- [Material Design 3](https://m3.material.io/)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [WAVE Accessibility Checker](https://wave.webaim.org/)
- [axe DevTools](https://www.deque.com/axe/devtools/)

---

## Quick Start: Implement Top 3 Fixes Today

```bash
# 1. Add to globals.css (5 min)
# - Focus visible states
# - Text wrapping
# - Font smoothing

# 2. Update layout.js (10 min)
# - Add viewport meta
# - Add skip-to-main link
# - Make sidebar responsive

# 3. Add aria-labels to icon buttons (15 min)
# - Sidebar icons
# - Action buttons across pages
# - Delete/edit buttons

# Total: 30 minutes for high-impact fixes
```

That's 10x faster than rewriting UI from scratch!
