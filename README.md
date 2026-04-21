# தமிழகவல் (Tamilahaval) - Tamil Content Publishing Platform

A comprehensive Tamil language content publishing web application for sharing lyrics, songs, poems, stories, and essays with integrated audio playback capabilities.

## 🌐 Live Site

**Production:** [https://tamilagaval.com](https://tamilagaval.com)
**Admin Portal:** [https://tamilagaval.com/admin](https://tamilagaval.com/admin)

---

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
- **AWS Cognito Authentication** - Secure login with email/password
- **Comprehensive Admin Dashboard** - Statistics and content overview
- **Tamil Transliteration** - Type in English, get Tamil automatically
  - Example: Type "vanakkam" → வணக்கம்
  - Toggle between English→Tamil and Direct Tamil modes
  - Real-time preview of Tamil output
  - Works 100% offline (no external API)
- **Content Management Interface** - Full CRUD operations
- **Media Library** - Image and audio file management
- **Comment Moderation** - Approve/reject user comments
- **User Management** - Role-based access control
- **Analytics and Statistics** - Content performance metrics

### Typography & Design
- **Logo Font**: Kavivanar (Google Fonts) - Tamil handwriting style
- **Body Font**: Noto Sans Tamil - Excellent readability
- **Custom Domain**: tamilagaval.com with SSL
- **Responsive Design**: Mobile-first approach
- **Purple Theme**: Professional gradient design

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

## ✍️ Tamil Transliteration Feature

Type in English and get Tamil text automatically! The admin portal includes an intelligent transliteration system.

### How It Works

**In the Admin Portal:**
1. Go to Create New Content
2. See the Tamil Input fields with a toggle button (🔤)
3. When toggle is ON (purple/green): Type English → Get Tamil
4. When toggle is OFF (gray): Type Tamil directly

### Example Conversions

```
vanakkam  → வணக்கம்  (Hello)
poo       → பூ       (Flower)
vaasam    → வாசம்    (Fragrance)
tamil     → தமிழ்    (Tamil)
nandri    → நன்றி    (Thank you)
paatu     → பாட்டு   (Song)
kavithai  → கவிதை   (Poem)
kathai    → கதை      (Story)
```

### Transliteration Rules

**Vowels:**
- a → அ, aa → ஆ, i → இ, ii → ஈ, u → உ, uu → ஊ
- e → எ, ee → ஏ, ai → ஐ, o → ஒ, oo → ஓ, au → ஔ

**Consonants + Vowels:**
- ka → க, ki → கி, ku → கு, kaa → கா
- pa → ப, pi → பி, pu → பு, paa → பா
- ma → ம, mi → மி, mu → மு, maa → மா
- (and so on for all Tamil consonants)

**Special Characters:**
- zh → ழ் (Tamil special L)
- ng → ங் (nasal sound)
- ch → ச்
- nj → ஞ்

### Features
- ✅ **Real-time conversion** as you type
- ✅ **Live preview** of Tamil output
- ✅ **Toggle on/off** for flexibility
- ✅ **Works offline** - no external API needed
- ✅ **Common word dictionary** for accuracy
- ✅ **Smart phonetic mapping**

## 🔐 Authentication & Security

### Admin Authentication
- **Provider**: AWS Cognito
- **Method**: Email + Password
- **Features**:
  - Secure user pool management
  - Password complexity requirements
  - Session management
  - Protected routes with middleware
  - Automatic redirects for unauthenticated access

### Security Measures
- Server-side environment variables
- Route protection middleware
- AWS IAM roles and policies
- SSL/TLS encryption (HTTPS)
- CORS configuration
- Input sanitization

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

- **Google Fonts** - Noto Sans Tamil & Kavivanar fonts
- **Next.js Team** - Amazing React framework
- **AWS** - Serverless infrastructure (Amplify, Cognito, DynamoDB, S3)
- **AWS Amplify UI** - Authentication components
- **Tailwind CSS** - Utility-first styling
- **Tamil Unicode Consortium** - Tamil character support

## 📊 Project Stats

- **Total Commits**: 20+
- **Lines of Code**: 10,000+
- **Components**: 25+
- **Test Coverage**: Unit, Integration, E2E
- **Deployment**: AWS Amplify (ca-central-1)
- **Domain**: tamilagaval.com
- **SSL**: Active ✓
- **Authentication**: Active ✓

---

**தமிழகவல்** - தமிழ் இலக்கியத்தை டிஜிட்டல் உலகிற்கு கொண்டு வருதல் 🌸
**Tamilahaval** - Bringing Tamil literature to the digital world 🌸
