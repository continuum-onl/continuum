# About Continuum

Continuum is an open-source app to write about your days, connect your thoughts, and resurface what matters.

## What is Continuum?

Continuum is built around the idea that notes shouldn't just be stored — they should stay connected to the things you care about.

With Continuum, you can:

- Create notes.
- Connect notes to each other.
- Mention people, projects, and topics.
- Visualize relationships through the knowledge graph.
- Import Markdown files.
- Sync your information across devices.
- Resurface relevant information when you need it.

The experience follows four simple steps:

1. **Capture** — Write down what matters.
2. **Connect** — Link notes, people, projects, and topics.
3. **Understand** — Explore relationships through your knowledge graph.
4. **Resurface** — Bring relevant knowledge back into your workflow.

## How it works

When you use Continuum, your information moves through a simple, transparent architecture:

1. **Frontend** — The React and TypeScript application is where you write, organize, and explore your knowledge.
2. **API** — The Continuum API handles application logic and communication between the app and your data.
3. **Authentication** — Secure authentication and authorization protect access to your account and resources.
4. **Database** — Structured application data is stored in MongoDB.
5. **File storage** — Files and notes are stored separately using Backblaze B2.

## Your data

Your notes, entities, relationships, and activity data belong to you. You can export everything and delete your account at any time. Continuum uses account-level ownership checks and protected API endpoints to keep users' data isolated.

Structured application data and file storage are kept separate. Authentication uses JWTs, refresh token handling, and token revocation to protect access to your account.

Continuum is an evolving open-source project. While we work to protect your information, no software can be considered perfectly secure. If you discover a security vulnerability, please report it privately before publishing details.

## Open source

Continuum is open source because we believe software that stores personal knowledge should be transparent about how it works.

You can inspect the source code, report issues, suggest improvements, and contribute to the project.

[View the source code on GitHub](https://github.com/continuum-onl/continuum)

## Technology

### Backend

- Java
- Spring Boot
- REST API

### Frontend

- React
- TypeScript

### Data

- MongoDB

### Storage

- Backblaze B2

### Infrastructure

- Redis
- Stripe

### Authentication

- JWT
- Google OAuth

---

Ready to organize what matters? [Try Continuum](https://continuum.onl).
