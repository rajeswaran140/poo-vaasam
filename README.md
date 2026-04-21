# தமிழகவல் (Tamilahaval) - Tamil Content Publishing Platform

A comprehensive Tamil language content publishing web application for sharing lyrics, songs, poems, stories, and essays with integrated audio playback capabilities.

## 🚀 Tech Stack

- **Frontend & Backend**: Next.js 15 with App Router + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Amazon DynamoDB (Single-Table Design)
- **Authentication**: AWS Cognito
- **Storage**: Amazon S3
- **Deployment**: AWS Amplify
- **Audio Player**: react-h5-audio-player
- **Testing**: Jest, React Testing Library, Playwright

## 🎯 Features

### Content Management
- Multi-type content support (Lyrics, Songs, Poems, Stories, Essays)
- Rich text editor with Tamil language support
- Image and audio file uploads
- Category and tag management
- Draft and publish workflows
- SEO optimization

### User Experience
- Reading-optimized Tamil text rendering
- Integrated audio player for listening experience
- Search functionality across all content
- Category and tag filtering
- Responsive design for mobile and desktop
- Dark mode support

### User Interaction
- User authentication and authorization
- Comment system with moderation
- Rating and review functionality
- Social sharing capabilities

### Admin Features
- Comprehensive admin dashboard
- Content management interface (CRUD)
- Media library
- Comment moderation
- User management
- Analytics and statistics

## 📁 Project Structure (Domain-Driven Design)

```
Tamil-web/
├── src/
│   ├── app/                      # Next.js App Router
│   ├── components/               # UI Components
│   ├── domain/                   # Domain Layer (DDD)
│   │   ├── entities/            # Business entities
│   │   ├── value-objects/       # Value objects
│   │   ├── aggregates/          # Aggregates
│   │   └── repositories/        # Repository interfaces
│   ├── application/              # Application Layer
│   │   ├── use-cases/           # Business use cases
│   │   └── services/            # Application services
│   ├── infrastructure/           # Infrastructure Layer
│   │   ├── database/            # DynamoDB implementation
│   │   ├── storage/             # S3 implementation
│   │   └── auth/                # Cognito implementation
│   ├── lib/                      # Utilities
│   ├── types/                    # TypeScript types
│   └── hooks/                    # React hooks
├── __tests__/                    # Tests
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # E2E tests
└── public/                       # Static assets
```

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+ installed
- AWS Account with appropriate permissions
- AWS Amplify CLI installed (`npm install -g @aws-amplify/cli`)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/rajeswaran140/poo-vaasam.git
cd poo-vaasam
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your AWS credentials and configuration
```

4. Initialize AWS Amplify:
```bash
amplify init
amplify push
```

5. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## 🧪 Testing

### Run Unit Tests
```bash
npm run test
```

### Run Integration Tests
```bash
npm run test:integration
```

### Run E2E Tests
```bash
npm run test:e2e
```

### Run All Tests
```bash
npm run test:all
```

## 📦 Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run test` - Run unit tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report

## 🏗️ Development Approach

### Domain-Driven Design (DDD)
- Clear separation of concerns across layers
- Business logic encapsulated in domain layer
- Infrastructure details isolated from domain logic

### Test-Driven Development (TDD)
- Write tests before implementation
- Unit tests for all business logic
- Integration tests for API routes and database operations
- E2E tests for critical user journeys

### Code Quality
- TypeScript for type safety
- ESLint for code linting
- Prettier for code formatting (to be added)
- Husky for pre-commit hooks (to be added)

## 🌐 Deployment

The application is configured for deployment on AWS Amplify:

```bash
# Deploy to AWS Amplify
git push origin master
# Amplify will automatically build and deploy
```

## 📝 Environment Variables

See `.env.example` for required environment variables.

**Important**: Never commit `.env.local` or `.env` files to version control.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Write tests for your changes (TDD approach)
4. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

## 📄 License

This project is private and proprietary.

## 👨‍💻 Author

**Rajeswaran**
- GitHub: [@rajeswaran140](https://github.com/rajeswaran140)

## 🙏 Acknowledgments

- Tamil font support by Google Fonts (Noto Sans Tamil)
- Next.js team for the amazing framework
- AWS for serverless infrastructure

---

**தமிழகவல்** - Bringing the fragrance of Tamil literature to the digital world 🌸
