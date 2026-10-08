Changelog

Every notable change to Continuum, from the first release to the latest version. Newest releases are listed first.

---

v1.3.1 — Oct 08, 2026

- Performance: Reduced startup delays when opening the app.
- Performance: Fixed scrolling issues across the app.
- Notes & Vault: Improved PDF rendering inside notes and the Vault.
- Trash: Added a trash system for deleted notes and entities, including restoration.
- Notes: Added image resizing.
- Limits: Added usage limit alerts.
- Projects & Activities: Added support for recording past entries.
- Account: Added self-service account deletion.
- Vault: Notes can now use files already stored in the Vault.
- UI: Polished the note index, note/entity selection, mention selector, subscription banner, Settings, entity details, and notification banners.

---

v1.3.0 — Sep 25, 2026

- UI/UX: Refined the overall interface and user experience.
- Settings: Replaced "/profile" with "/settings" and redesigned the Settings experience.
- Navigation: Improved the mobile bottom navigation.
- Subscriptions: Refined the subscription experience.
- Performance: Added caching to improve loading speed and responsiveness.
- Search: Added note search on both mobile and desktop.
- Editor: Fixed Markdown rendering when changing body text size.

---

v1.2.16 — Sep 13, 2026

- Mobile: Added the first Android app build using Capacitor.
- Navigation: Removed the "/" route from the Dashboard.

---

v1.2.15 — Aug 29, 2026

- Backend: Refined environment and backend configuration.

---

v1.2.12 — Aug 30, 2026

- Editor: Refined the note editor and its styling.

---

v1.2.11 — Aug 30, 2026

- UI: Added minor visual refinements across the app.

---

v1.2.10 — Aug 30, 2026

- Profile: Continued improvements to profile wallpapers.
- Editor: Refined editor font sizing.

---

v1.2.9 — Aug 30, 2026

- Editor: Added adjustable font sizes to the note editor.
- Profile: Added related editor preferences to Profile.

---

v1.2.8 — Aug 30, 2026

- Authentication: Reworked sign-in and sign-up redirects.
- Routing: Fixed navigation issues across several pages.
- Free Plan: Adjusted free plan limits.
- Data Export: Made data export available exclusively to paid plans.
- Backend: Removed a leftover static Google authentication file from the build.

---

v1.2.6 — Aug 26, 2026

- Notifications: Migrated notifications from Discord to Telegram.
- Performance: Improved page transitions and loading animations.
- Profile: Added new wallpaper customization options.
- Notes: Rebuilt the note editor and Notes page for a better writing experience.
- UI: Refined the Dashboard, Entities, Insights, and Vault pages.

---

v1.2.5 — Aug 10, 2026

- Backend: Refined environment configuration.

---

v1.2.4 — Aug 10, 2026

- Dashboard: Added Score Evolution, showing how your score changes over time.
- Notifications: Added Discord notifications for important events.
- Metrics: Rebuilt the metrics engine.

---

v1.2.3 — Aug 09, 2026

- Backend: Refined environment configuration.

---

v1.2.1 — Aug 09, 2026

- Notes: Added collapsible sections by heading.
- Editor: Added configurable editor modes.
- Vault: Added custom vault naming.
- Subscriptions: Added a new subscription management modal.
- Billing: Added automatic Stripe payment reconciliation with full event auditing.
- Time Tracking: Made requests time-zone aware.

---

v1.2.0 — Aug 04, 2026

- Visual Redesign: Redesigned nearly every core page, including Dashboard, Entities, Insights, Knowledge Graph, Notes, Pricing, Profile, Projects, Subscription, and Vault.
- UI: Introduced reusable interface components across the app.

---

v1.1.2 — Jul 29, 2026

- Landing Page: Fixed a minor visual issue.

---

v1.1.1 — Jul 29, 2026

- PWA: Added install support with installation prompts and buttons.
- Authentication: Reworked the Dashboard and authentication screens, including Login, Forgot Password, and Register.

---

v1.1.0 — Jul 29, 2026

- Time Tracking: Fixed time-tracking behavior.

---

v1.0.4 — Jul 28, 2026

- Security: Hardened backend security.

---

v1.0.3 — Jul 28, 2026

- Backend: Refined environment configuration.

---

v1.0.2 — Jul 28, 2026

- Codebase: Removed unused code and simplified the build configuration.

---

v1.0.1 — Jul 28, 2026

- Offline: Added offline support with automatic synchronization when connectivity is restored.
- Time Tracking: Added activity calendars and time-tracking history.
- Localization: Added a language switcher and modular translation system.
- Pages: Added About, Pricing, and Support pages.
- Goals: Added timer goals and related notifications.
- Billing: Migrated payments from Lemon Squeezy to Stripe.
- Billing: Removed the Lemon Squeezy integration.
- Import: Added Markdown file import with a confirmation step before committing changes.
- Editor: Expanded the note editor with find and replace, a status bar, keyboard shortcuts, and more.
- Authentication: Added a new sign-up experience.
- Analytics: Added Vercel Web Analytics and Speed Insights.
- Authentication: Fixed Google login and token refresh issues.

---

v1.0.0 — May 28, 2026

🎉 The first full release of Continuum.

- Authentication: Email/password and Google sign-in with secure token refresh.
- Vault: Private file storage backed by Backblaze B2.
- Notes: Notes linked to entities with an interactive Knowledge Graph.
- Insights: Dashboard, Insights, and usage metrics.
- Time Tracking: Time tracking for activities and entities.
- Billing: Subscription and billing support through Stripe and Lemon Squeezy.
- Website: Landing page, Terms, and Privacy pages.

---

Initial Commit — May 27, 2026

- Created the Continuum repository.
- Added the initial license.
- Added a placeholder README.
