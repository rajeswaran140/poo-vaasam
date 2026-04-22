# Admin Portal Optimization Tasks

## 🔴 CRITICAL (This Week)

### Task 1: Add API Authentication
**Files to modify**:
- `src/lib/auth-helper.ts` (create new)
- `src/app/api/content/route.ts`
- `src/app/api/test/content/route.ts`

**Steps**:
1. Create auth helper function
2. Add auth check to each API route
3. Return 401 for unauthorized requests
4. Test with Postman

**Estimated time**: 2 hours

---

### Task 2: Create Missing Pages
**Files to create**:
- `src/app/(admin)/admin/settings/page.tsx`
- `src/app/(admin)/admin/media/page.tsx`

**Steps**:
1. Create placeholder pages with basic UI
2. Add headings and empty state messages
3. Link to relevant documentation

**Estimated time**: 1 hour

---

### Task 3: Add Form Validation
**Files to modify**:
- `src/app/(admin)/admin/content/new/page.tsx`
- `src/app/(admin)/admin/categories/page.tsx`
- `src/app/(admin)/admin/tags/page.tsx`

**Steps**:
1. Install `zod` validation library
2. Create validation schemas
3. Validate before API calls
4. Show inline error messages

**Estimated time**: 3 hours

---

## ⚠️ HIGH PRIORITY (Next 2 Weeks)

### Task 4: Implement Real Pagination
**Files to modify**:
- `src/app/(admin)/admin/content/page.tsx`

**Steps**:
1. Add state for current page
2. Calculate total pages from API
3. Wire up Next/Previous buttons
4. Update API call with offset/limit

**Estimated time**: 2 hours

---

### Task 5: Add Error Boundary
**Files to create**:
- `src/app/(admin)/error.tsx`

**Steps**:
1. Create error boundary component
2. Add reset functionality
3. Log errors to monitoring service

**Estimated time**: 1 hour

---

### Task 6: Replace alert() with Toast
**Dependencies**: Install `sonner` or `react-hot-toast`

**Files to modify**:
- All admin pages using `alert()`

**Steps**:
1. Install toast library
2. Create ToastProvider wrapper
3. Replace all alert() calls
4. Style toasts to match theme

**Estimated time**: 2 hours

---

### Task 7: Add File Upload
**Files to create**:
- `src/components/admin/FileUpload.tsx`
- `src/app/api/upload/route.ts`

**Files to modify**:
- `src/app/(admin)/admin/content/new/page.tsx`

**Steps**:
1. Create S3 presigned URL generator
2. Build drag-drop upload component
3. Integrate with content form
4. Show upload progress

**Estimated time**: 4 hours

---

## 💡 MEDIUM PRIORITY (Next Month)

### Task 8: Add Loading States
- Add Suspense boundaries
- Create skeleton components
- Show spinners during API calls

**Estimated time**: 3 hours

---

### Task 9: Mobile Optimization
- Add hamburger menu
- Make tables responsive
- Collapse sidebar on mobile

**Estimated time**: 4 hours

---

### Task 10: Content Preview
- Add preview mode to forms
- Show how content will look
- Support all content types

**Estimated time**: 3 hours

---

### Task 11: Fix TypeScript Types
- Replace `any` with proper types
- Add strict mode
- Fix type errors

**Estimated time**: 2 hours

---

## 📊 Priority Matrix

| Priority | Tasks | Total Time |
|----------|-------|------------|
| Critical | 3 | ~6 hours |
| High | 4 | ~9 hours |
| Medium | 4 | ~12 hours |

**Total estimated effort**: ~27 hours (3-4 days of focused work)

---

## Quick Wins (Do First)

1. ✅ Create missing pages (1 hour) - Prevents 404 errors
2. ✅ Add form validation (3 hours) - Improves security & UX
3. ✅ Add error boundary (1 hour) - Prevents crashes

**Total**: 5 hours for major improvements!

---

## Testing Checklist

After each task:
- [ ] Test on desktop browser
- [ ] Test on mobile browser
- [ ] Test with slow network (throttle in DevTools)
- [ ] Test error scenarios
- [ ] Check accessibility (keyboard navigation)
- [ ] Verify no console errors

---

## Resources Needed

**NPM Packages**:
```bash
npm install zod sonner @aws-sdk/s3-presigned-post
npm install -D @types/node
```

**AWS Services**:
- S3 bucket with CORS configured
- Cognito for user validation
- DynamoDB for data storage

---

## Contact for Help

If stuck on any task:
1. Check Next.js 15 documentation
2. Review AWS Amplify v6 docs
3. Search Stack Overflow
4. Ask Claude! 🤖

---

**Last Updated**: 2026-04-21
**Status**: Ready to implement
