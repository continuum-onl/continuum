# Continuum

> Your notes shouldn't just be stored. They should stay connected.

**Continuum** is an open-source personal knowledge management system built to help you capture ideas, connect information, and rediscover what you've already learned.

Instead of treating notes as isolated documents, Continuum organizes knowledge around the relationships between **people, projects, topics, and ideas**.

---

## Why Continuum?

Most note-taking systems are very good at helping you **write things down**.

The harder part is remembering to come back to them.

You might have:

- hundreds of notes;
- ideas scattered across different documents;
- information about the same project in multiple places;
- useful context that you forgot you had written down.

Continuum was built around a simple idea:

> **Your knowledge becomes more useful when it stays connected and comes back at the right time.**

---

## How it works

Continuum revolves around four simple concepts:

### 1. Capture

Write down thoughts, information, decisions, ideas, or anything you want to remember.

Your notes are stored as Markdown-based content.

### 2. Connect

Connect your notes to the things they are about.

For example:

    Note
     ├── Project: Continuum
     ├── Person: Alice
     └── Topic: Knowledge Management

These relationships allow information to become more than a collection of isolated documents.

### 3. Understand

Continuum builds relationships between your notes and entities.

These relationships can be explored through the knowledge graph, giving you a different way to navigate your information.

Instead of asking:

> "Where did I write that?"

you can start from:

> "What do I know about this project?"

### 4. Resurface

Continuum uses relevance and activity information to help bring older knowledge back into your workflow.

The goal isn't to make you manually review everything you've ever written.

It's to help the right information come back when it can be useful.

---

# Features

### 📝 Markdown notes

Write and organize your knowledge using Markdown-based content.

### 🔗 Connected knowledge

Link notes to people, projects, topics and other entities.

### 🕸️ Knowledge graph

Explore the relationships between your notes and entities visually.

### 🔄 Native synchronization

Keep your knowledge synchronized across supported clients.

### 📥 Markdown import

Bring existing Markdown notes into Continuum.

### 🧠 Smart resurfacing

Relevant information can return to your attention based on activity and relevance.

### 👤 Entity-based organization

People, projects and topics can become first-class objects in your knowledge system.

### 🔐 Account-based data isolation

Private data is associated with the authenticated account and backend operations verify ownership when accessing protected resources.

---

# Open Source

Continuum is open source.

We believe software that stores personal knowledge should be transparent about how it works.

You can inspect the source code, report issues, suggest improvements and contribute to the project.

**Source code:**

https://github.com/continuum-onl/continuum

**Versions / changelog:**

[frontend/versions.md](frontend/versions.md)

If you find a security issue, please report it responsibly rather than publicly exposing sensitive information.

---

# Architecture

At a high level, Continuum works like this:

    User
      │
      ▼
    Frontend
    React / TypeScript
      │
      ▼
    Continuum API
    Java / Spring Boot
      │
      ├───────────────┐
      ▼               ▼
    MongoDB       File Storage
    Structured    Backblaze B2
    application
    data

The backend is responsible for authentication, authorization, application logic and access to user data.

Structured application data is stored separately from file/note storage.

---

# Technology

## Backend

- Java
- Spring Boot
- REST API
- JWT authentication
- Google OAuth
- MongoDB
- Redis
- Backblaze B2

## Frontend

- React
- TypeScript

## Other services

- Stripe
- Maven
- Git

The exact implementation may evolve as Continuum develops.

---

# Security

Security is especially important for a personal knowledge management system.

Continuum currently uses several mechanisms to protect authenticated resources, including:

- JWT-based authentication;
- refresh token handling;
- token revocation;
- account-level ownership checks;
- request rate limiting;
- input/content sanitization;
- protected API endpoints;
- separation between structured data and file storage.

However:

> **Continuum is an evolving open-source project and should not be considered perfectly secure.**

Open source does not automatically mean secure.

We encourage users and developers to inspect the implementation, report vulnerabilities and contribute improvements.

If you discover a security vulnerability, please report it privately before publishing details.

---

# Privacy

Continuum is designed around the idea that your personal knowledge should remain associated with your account.

The application uses authentication and ownership checks when accessing private resources.

For the complete and current details about data handling, see:

- Privacy Policy
- Terms of Service

These documents should be considered the authoritative source for how Continuum handles user data.

---

# Getting started

## Requirements

Depending on the current project configuration, you may need:

- Java 21+
- Node.js
- MongoDB
- Redis
- Backblaze B2 credentials
- environment variables for authentication and external services

Check the backend and frontend documentation for the current development configuration.

---

# Project structure

    continuum/
    │
    ├── backend/
    │   ├── src/
    │   ├── pom.xml
    │   └── ...
    │
    ├── frontend/
    │   ├── src/
    │   ├── package.json
    │   └── ...
    │
    └── README.md

The backend contains the API, authentication, application logic and persistence infrastructure.

The frontend contains the user interface and client-side application logic.

---

# Development

Clone the repository:

    git clone https://github.com/continuum-onl/continuum.git
    cd continuum

Then follow the setup instructions inside the `backend` and `frontend` directories.

Because Continuum depends on external services, some environment variables and credentials are required for a complete local environment.

Never commit secrets, API keys, database credentials or production credentials to the repository.

---

# Contributing

Contributions are welcome.

You can help by:

- reporting bugs;
- suggesting features;
- improving documentation;
- reviewing code;
- fixing issues;
- improving tests;
- improving security;
- contributing new functionality.

Before opening a large pull request, consider opening an issue first so the direction can be discussed.

---

# Philosophy

Continuum is built around a simple belief:

> **Knowledge shouldn't disappear just because you stopped looking at it.**

The goal isn't to build another place where information goes to die.

It's to create a system where your notes remain connected, contextualized and capable of resurfacing when they matter.

---

# Roadmap

Continuum is actively evolving.

The roadmap may include improvements to:

- synchronization;
- knowledge graph exploration;
- resurfacing;
- search;
- mobile experience;
- collaboration;
- performance;
- security;
- import/export;
- developer tooling.

Check the GitHub repository for the current state of development.

---

# License

See the repository's license file for the current licensing terms.

---

## Links

**Website:** https://continuum.onl

**GitHub:** https://github.com/continuum-onl/continuum

**Privacy:** https://continuum.onl/privacy

**Terms:** https://continuum.onl/terms

---

<p align="center">
  Built in the open.
  <br>
  <strong>Continuum</strong> — Capture. Connect. Resurface.
</p>
