// Confirmed portfolio data for Shivansh Dhakad
// All information comes directly from verified resume and confirmed project inputs.

export interface SkillItem {
  id: string
  name: string
  // A skill can belong to several domains (e.g. HTML: Programming + Web Development).
  domains: SkillDomain[]
  primaryDomain?: SkillDomain
  relatedSkills?: string[]
}

// Known domains have fixed colours; categories added in the admin dashboard are plain strings.
export type SkillDomain = string

export interface ProjectFile {
  name: string
  language: 'markdown' | 'json'
  content: string
}

export interface ProjectChallenge {
  challenge: string
  solution: string
}

export interface ProjectItem {
  id: string
  slug: string
  title: string
  tagline: string
  featured: boolean
  sortOrder: number
  status: 'Live' | 'Active' | 'Completed' | 'Research'
  category: string
  repoUrl: string | null
  demoUrl: string | null
  docsUrl: string | null
  coverImage?: string
  skills: string[]
  whatItIs: string
  whatIDeveloped: string[]
  mainFeatures: string[]
  architectureDiagram?: string
  challengesSolved: ProjectChallenge[]
  techStackGrouped: {
    languages: string[]
    frameworks: string[]
    backend: string[]
    tools: string[]
  }
  files: Record<string, ProjectFile>
  // Filled from the database (admin dashboard)
  problem?: string
  solution?: string
  results?: string
  changelog?: string
  metrics?: { name: string; value: string; description?: string }[]
  images?: { url: string; alt: string }[]
  extraLinks?: { label: string; url: string }[]
}

export interface EducationItem {
  id: string
  type: 'college' | 'school'
  institute: string
  degree: string
  duration: string
  completionYear: string
}

export interface JourneyDestination {
  id: string
  step: number
  title: string
  tagline: string
  category: string
  color: string
  skills: string[]
  description: string
  keyLearnings: string[]
}

export interface BeyondCodeItem {
  id: string
  title: string
  category: string
  description: string
  placeholderType: 'audio' | 'photo'
}

export const PROFILE_DATA = {
  fullName: 'Shivansh Dhakad',
  headline: 'Student focusing on Machine Learning and AI development',
  subheadline: 'B.Tech CSE (AI & ML) • LNCT Bhopal (2024–2028)',
  intro:
    'Computer Science (AI & ML) student with hands-on experience building machine learning, deep learning, computer vision, and retrieval-augmented generation applications.',
  bio:
    'Undergraduate computer science engineer specializing in Artificial Intelligence & Machine Learning at LNCT Bhopal. I focus on developing full-stack ML solutions—from raw dataset engineering and neural network modeling to production API deployment. My work spans satellite SAR image processing, clinical risk prediction, multilingual translation, and autonomous AI agents.',
  email: 'shivanshdhakad.dev@gmail.com',
  location: 'Bhopal, Madhya Pradesh, India',
  photoUrl: '/photo.webp',
  githubUrl: 'https://github.com/shivansh-dhakad',
  linkedinUrl: 'https://linkedin.com/in/shivansh-dhakad-007679294',
  resumeUrl: null as string | null, // Marked coming soon until sanitized PDF without phone number is uploaded
  resumeNote: 'Sanitized PDF (without phone number) coming soon',
  interests: ['Flute Playing (Bansuri)', 'Long-Distance Bike Riding', 'Machine Learning Research', 'Open Source'],
}

// Strict requirement: Only show College Education and School Education
// Showing only: what I did, school/college name, duration (year of completion)
export const EDUCATION_DATA: EducationItem[] = [
  {
    id: 'edu-college',
    type: 'college',
    institute: 'Lakshmi Narain College of Technology (LNCT), Bhopal',
    degree: 'B.Tech in Computer Science & Engineering (Artificial Intelligence and Machine Learning)',
    duration: '2024 – 2028',
    completionYear: '2028',
  },
  {
    id: 'edu-school',
    type: 'school',
    institute: 'Gurukul School, Bareli',
    degree: 'Class XII completed (Senior Secondary) · Science stream with PCM (Physics, Chemistry, Mathematics)',
    duration: '2022 – 2024',
    completionYear: '2024',
  },
]

// Journey of Learning Destinations along a visual pathway
export const LEARNING_JOURNEY_DATA: JourneyDestination[] = [
  {
    id: 'dest-1',
    step: 1,
    title: 'Basic Languages & Web Foundations',
    tagline: 'Algorithmic logic, data structures, and interactive UI systems',
    category: 'Foundations',
    color: '#38bdf8', // Vibrant Sky Blue
    skills: ['Python', 'C++', 'HTML', 'CSS', 'JavaScript', 'React'],
    description:
      'Mastered computational thinking, memory structures, OOP paradigms in C++ & Python, and constructed responsive web interfaces with modern JavaScript and React.',
    keyLearnings: [
      'Algorithmic problem-solving & data structures',
      'Clean modular object-oriented architecture in Python & C++',
      'Component-driven declarative interfaces with React & CSS',
    ],
  },
  {
    id: 'dest-2',
    step: 2,
    title: 'Data Analysis & Manipulation',
    tagline: 'Tabular feature extraction, numerical arrays, and statistical EDA',
    category: 'Data Science',
    color: '#10b981', // Emerald Green
    skills: ['Pandas', 'NumPy', 'Matplotlib', 'Seaborn', 'Exploratory Data Analysis'],
    description:
      'Transitioned from raw datasets to structured insights: vector broadcasting, missing data imputation, outlier detection, and multidimensional statistical visualizations.',
    keyLearnings: [
      'High-performance array computing with NumPy',
      'Data cleaning, transformation & aggregation pipelines in Pandas',
      'Distribution analysis & publication-ready plots with Matplotlib and Seaborn',
    ],
  },
  {
    id: 'dest-3',
    step: 3,
    title: 'Classical Machine Learning',
    tagline: 'Supervised & unsupervised inference, gradient boosting & explainability',
    category: 'Predictive ML',
    color: '#a855f7', // Electric Violet
    skills: ['Scikit-Learn', 'Regression', 'Classification', 'Clustering', 'XGBoost', 'SHAP'],
    description:
      'Engineered end-to-end predictive models with cross-validation, hyperparameter tuning, cost-sensitive learning for clinical risk datasets, and feature attribution.',
    keyLearnings: [
      'Bias-variance tradeoff, regularization & cross-validation metrics',
      'Tree ensembles and gradient boosting with XGBoost & Random Forests',
      'Model interpretability and feature attribution using SHAP',
    ],
  },
  {
    id: 'dest-4',
    step: 4,
    title: 'Deep Learning & Computer Vision',
    tagline: 'Convolutional neural networks, spatial tensors & radar satellite perception',
    category: 'Deep Perception',
    color: '#f59e0b', // Warm Amber
    skills: ['PyTorch', 'TensorFlow', 'CNNs', 'Computer Vision', 'OpenCV', 'SAR Imagery'],
    description:
      'Architected deep convolutional networks for real-world visual perception—segmenting marine oil spills in satellite SAR imagery (VarunaDrishti) and foliar plant disease detection (KrishiMitra).',
    keyLearnings: [
      'Custom CNNs and U-Net encoder-decoder segmentation backbones in PyTorch',
      'Radar speckle reduction and radiometric image processing in OpenCV',
      'Focal loss formulations to resolve extreme class imbalance in satellite tiles',
    ],
  },
  {
    id: 'dest-5',
    step: 5,
    title: 'Generative AI & Multimodal RAG',
    tagline: 'Transformers, grounded semantic retrieval & multilingual translation',
    category: 'Generative Intelligence',
    color: '#06b6d4', // Cyan
    skills: ['Large Language Models', 'RAG', 'LangChain', 'Hugging Face', 'Vector Databases', 'Transformers'],
    description:
      'Developed grounded intelligence platforms combining vector embeddings with dense keyword reranking (LUMINA) and bilingual sequence-to-sequence neural translation (English-to-Hindi).',
    keyLearnings: [
      'Hybrid semantic vector search with strict source citation grounding',
      'Subword Devanagari tokenization & beam search translation decoding',
      'Asynchronous token streaming interfaces using FastAPI',
    ],
  },
  {
    id: 'dest-6',
    step: 6,
    title: 'Agentic AI & Autonomous Workflows',
    tagline: 'Tool-calling agents, persistent memory & multi-agent execution graphs',
    category: 'Active Frontier',
    color: '#ec4899', // Radiant Rose
    skills: ['Autonomous Agents', 'Tool Calling', 'Multi-Agent Coordination', 'Stateful Memory', 'Task Planning'],
    description:
      'Advancing into self-directed AI systems: dynamic execution plans, reflection loops, deterministic tool invocation, and collaborative multi-agent problem solving.',
    keyLearnings: [
      'Agentic reasoning loops with reflection and error self-correction',
      'Structured tool calling in sandboxed execution environments',
      'Hierarchical context management & memory persistence across tasks',
    ],
  },
]

export const SKILL_DOMAINS: SkillDomain[] = [
  'Languages & Core',
  'Data Analysis',
  'Machine Learning',
  'Deep Learning',
  'Generative AI',
  'Agentic AI & Backend',
]

export const PROJECTS_DATA: ProjectItem[] = [
  // 1. VarunaDrishti (Featured 1)
  {
    id: 'proj-1',
    slug: 'varunadrishti',
    title: 'VarunaDrishti',
    tagline: 'Satellite SAR oil spill detection & automated maritime vessel identification system',
    featured: true,
    sortOrder: 1,
    status: 'Active',
    category: 'Computer Vision & Remote Sensing',
    repoUrl: 'https://github.com/shivansh-dhakad/oil-spill-detection-and-vessel-identification',
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'PyTorch', 'Computer Vision', 'OpenCV', 'CNNs', 'FastAPI'],
    whatItIs:
      'VarunaDrishti is a deep learning remote-sensing framework designed to automatically detect hazardous marine oil spills and identify maritime vessels from Synthetic Aperture Radar (SAR) satellite imagery. SAR operates through dense clouds, monsoons, and nighttime darkness when traditional optical satellites are completely blind.',
    whatIDeveloped: [
      'Dual-branch convolutional network architecture: semantic segmentation for oil spill plumes and intensity-peak detector for metallic vessel corner reflectors.',
      'Custom pre-processing pipeline in OpenCV for SAR radiometric calibration and adaptive Lee speckle noise attenuation.',
      'Focal Tversky Loss function implementation to handle extreme pixel class imbalance (spills occupy <0.5% of oceanic tiles).',
      'Containerized FastAPI microservice delivering GeoJSON coordinates and segmentation masks for coastal authority monitoring.',
    ],
    mainFeatures: [
      'All-Weather Radar Sensing: Unaffected by monsoons, heavy cloud covers, or zero-light nighttime conditions.',
      'Adaptive Speckle Filter: Attenuates multiplicative radar noise while preserving razor-thin oil plume boundaries.',
      'Look-Alike Disambiguation: Distinguishes true petroleum slicks from biogenic films and natural low-wind zones.',
      'Vessel Correlation: Automatically maps nearby ships to the centroid of detected illegal ballast discharge plumes.',
    ],
    architectureDiagram: `[SAR Satellite GeoTIFF (Sentinel-1)]
         │
         ▼
[Radiometric Calibration & Lee Speckle Filtering]
         │
         ├──► [Segmentation Branch: Modified U-Net] ──► [Oil Spill Mask GeoJSON]
         │
         └──► [Vessel Peak Detector Branch]        ──► [Vessel GPS Coordinates]`,
    challengesSolved: [
      {
        challenge: 'Severe Radar Speckle Noise',
        solution: 'Implemented adaptive Lee and median filtering to smooth homogeneous ocean backscatter while preserving high-gradient boundary edges of slick contours.',
      },
      {
        challenge: 'Extreme Class Imbalance',
        solution: 'Formulated a combined Focal Tversky Loss to heavily penalize false negatives without causing the model to over-predict background seawater.',
      },
    ],
    techStackGrouped: {
      languages: ['Python 3.11'],
      frameworks: ['PyTorch', 'TorchVision', 'CNNs'],
      backend: ['FastAPI', 'Uvicorn'],
      tools: ['OpenCV', 'NumPy', 'GeoJSON', 'Rasterio'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# VarunaDrishti\n\nAutomated SAR Satellite Oil Spill & Maritime Vessel Detection.`,
      },
    },
  },

  // 2. LUMINA (Featured 2)
  {
    id: 'proj-2',
    slug: 'lumina',
    title: 'LUMINA',
    tagline: 'Multimodal AI platform uniting vision perception with conversational RAG intelligence',
    featured: true,
    sortOrder: 2,
    status: 'Active',
    category: 'Generative AI & Multimodal RAG',
    repoUrl: null,
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'PyTorch', 'Large Language Models', 'RAG', 'LangChain', 'Vector Databases', 'FastAPI', 'React'],
    whatItIs:
      'LUMINA is an intelligent multimodal knowledge platform that combines computer vision document understanding with Retrieval-Augmented Generation (RAG) to query complex technical documents, schematics, and academic papers with strict source citation verification.',
    whatIDeveloped: [
      'Hybrid retrieval engine combining dense vector embeddings with sparse BM25 keyword matching and cross-encoder reranking.',
      'Structure-aware parser extracting text, tabular data, and visual diagrams without losing hierarchical context.',
      'Contextual hallucination mitigation guardrails that explicitly flag ungrounded answers.',
      'Asynchronous token streaming pipeline delivering real-time responses to a reactive web frontend.',
    ],
    mainFeatures: [
      'Multimodal Document Parsing: Simultaneously reads text, tables, graphs, and schematic diagrams.',
      'Strict Citation Grounding: Every assertion points to specific paragraph chunks and visual bounding boxes.',
      'Dynamic Semantic Chunking: Prevents code blocks and equations from being severed during indexing.',
      'Low-Latency Streaming: Real-time generation powered by asynchronous server-sent events.',
    ],
    architectureDiagram: `[Query + Complex Documents]
         │
         ├──► [Structure-Aware Multi-Parser (Text, Tables, Diagrams)]
         │           │
         │           ▼
         ├──► [Hybrid Vector & BM25 Index] ──► [Cross-Encoder Reranker]
         │                                               │
         ▼                                               ▼
[Grounded LLM Generation Engine] ──► [Streaming Answer + Source Citations]`,
    challengesSolved: [
      {
        challenge: 'Chunk Fragmentation in Complex Tables',
        solution: 'Developed markdown-aware recursive chunking that respects semantic headers and keeps tabular structures intact.',
      },
      {
        challenge: 'Generative Hallucinations',
        solution: 'Configured relevance score thresholding: if source confidence falls below threshold, LUMINA flags insufficient evidence rather than guessing.',
      },
    ],
    techStackGrouped: {
      languages: ['Python', 'TypeScript'],
      frameworks: ['LangChain', 'Hugging Face Transformers'],
      backend: ['FastAPI', 'Asyncio'],
      tools: ['ChromaDB', 'React', 'Tailwind', 'Vector Stores'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# LUMINA\n\nMultimodal AI & Grounded RAG Platform.`,
      },
    },
  },

  // 3. KrishiMitra (Featured 3)
  {
    id: 'proj-3',
    slug: 'krishimitra',
    title: 'KrishiMitra',
    tagline: 'AI-driven precision agriculture advisor with real-time crop disease diagnosis',
    featured: true,
    sortOrder: 3,
    status: 'Active',
    category: 'Computer Vision & AgriTech',
    repoUrl: null,
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'TensorFlow', 'Computer Vision', 'Scikit-Learn', 'Flask', 'React'],
    whatItIs:
      'KrishiMitra is an intelligent agricultural decision-support system engineered to help farmers rapidly detect foliar crop diseases, assess soil conditions, and receive localized organic and chemical remediation advice directly through a mobile web portal.',
    whatIDeveloped: [
      'Convolutional neural network classifier trained across multiple agricultural foliar pathology datasets.',
      'Field lighting & dust augmentation pipeline to ensure model resilience under harsh direct sunlight and mobile camera noise.',
      'Agronomic remediation engine providing chemical guidance as well as localized organic bio-pesticide formulations in bilingual formats.',
      'Lightweight quantized inference model optimized for quick execution on low-bandwidth rural mobile networks.',
    ],
    mainFeatures: [
      'Multi-Crop Foliar Diagnosis: Rapidly identifies bacterial blights, fungal rusts, and pest damage.',
      'Dual Remediation Protocols: Delivers both organic herbal recipes and standard certified agricultural treatments.',
      'Quantized Edge Inference: Designed to run efficiently without requiring high-end computing hardware.',
      'Weather-Correlated Risk: Correlates ambient humidity forecasts with disease progression risk.',
    ],
    challengesSolved: [
      {
        challenge: 'Variable Outdoor Field Lighting',
        solution: 'Trained with extensive photometric data augmentations (gamma correction, shadows, color temperature shifts) to maintain accuracy under field conditions.',
      },
      {
        challenge: 'Rural Connectivity Constraints',
        solution: 'Exported a lightweight quantized MobileNet model allowing near-instantaneous inference over slow mobile networks.',
      },
    ],
    techStackGrouped: {
      languages: ['Python', 'JavaScript'],
      frameworks: ['TensorFlow', 'Keras', 'MobileNet'],
      backend: ['Flask', 'REST APIs'],
      tools: ['OpenCV', 'Pandas', 'NumPy', 'React'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# KrishiMitra\n\nAI Precision Agriculture & Crop Pathology Engine.`,
      },
    },
  },

  // 4. CardioShield AI (Featured 4)
  {
    id: 'proj-4',
    slug: 'cardioshield-ai',
    title: 'CardioShield AI',
    tagline: 'Clinical biomarker cardiovascular risk assessment & early stratification model',
    featured: true,
    sortOrder: 4,
    status: 'Active',
    category: 'Healthcare & Predictive ML',
    repoUrl: null,
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'Scikit-Learn', 'Machine Learning', 'XGBoost', 'Pandas', 'NumPy'],
    whatItIs:
      'CardioShield AI is a clinical machine learning system that stratifies cardiovascular disease risk using patient physiological biomarkers, lipid fractions, and lifestyle indicators, providing doctors with interpretable risk explanations.',
    whatIDeveloped: [
      'Robust ensemble classification pipeline benchmarking Logistic Regression, Random Forest, and tuned XGBoost models.',
      'Clinical data preprocessing pipeline handling physiological outliers, skewed lipid distributions, and missing medical records.',
      'SHAP (SHapley Additive exPlanations) interpretability module displaying personalized risk contributor waterfalls for clinicians.',
      'Probability calibration curve validation ensuring model probabilities accurately mirror observed empirical medical risk.',
    ],
    mainFeatures: [
      'Biomarker-Driven Risk Stratification: Evaluates systolic/diastolic pressures, cholesterol, glucose, BMI, and age.',
      'Model Explainability: Highlights exactly which clinical parameters push a patient into higher risk brackets.',
      'Cost-Sensitive Optimization: Tuned decision thresholds to prioritize sensitivity and minimize critical false negatives.',
      'Calibrated Probabilities: Outputs reliable risk likelihoods verified against medical benchmarks.',
    ],
    challengesSolved: [
      {
        challenge: 'Asymmetric Medical Risk (False Negatives)',
        solution: 'Applied cost-sensitive learning to adjust the classification threshold, prioritizing high recall to prevent missing vulnerable cardiac patients.',
      },
      {
        challenge: 'Feature Collinearity in Blood Pressures',
        solution: 'Utilized elastic net regularization and gradient boosted decision splits to handle correlated physiological metrics robustly.',
      },
    ],
    techStackGrouped: {
      languages: ['Python 3.11'],
      frameworks: ['Scikit-Learn', 'XGBoost'],
      backend: ['FastAPI / Python'],
      tools: ['Pandas', 'NumPy', 'SHAP', 'Matplotlib'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# CardioShield AI\n\nCardiovascular Clinical Risk Prediction.`,
      },
    },
  },

  // 5. English–Hindi Translator (Featured 5)
  {
    id: 'proj-5',
    slug: 'english-hindi-translator',
    title: 'English–Hindi Translator',
    tagline: 'Neural machine translation and linguistic transformation model for English-to-Hindi text',
    featured: true,
    sortOrder: 5,
    status: 'Completed',
    category: 'Natural Language Processing',
    repoUrl: 'https://github.com/shivansh-dhakad/English---hindi-translator',
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'PyTorch', 'Deep Learning', 'Hugging Face', 'Large Language Models'],
    whatItIs:
      'A specialized neural machine translation pipeline trained to translate English prose into fluent, context-preserving Hindi with correct grammatical gender agreement, case markers, and natural sentence structure (SOV word order).',
    whatIDeveloped: [
      'Sequence-to-sequence transformer translation pipeline fine-tuned on bilingual parallel text corpora.',
      'Custom tokenization preprocessing pipeline handling complex Devanagari script conjuncts and vowel ligatures.',
      'Beam search decoding procedure with length penalty optimization to prevent truncation or redundant loops.',
      'Evaluation pipeline calculating SacreBLEU and chrF++ scores across diverse domain test sets.',
    ],
    mainFeatures: [
      'Devanagari Subword Tokenization: Preserves complex Hindi inflectional morphology and script diacritics.',
      'Beam Search Decoding: Explores high-probability linguistic hypotheses for natural phrasing.',
      'Domain Generalization: Handles conversational sentences, technical documentation, and educational materials.',
      'Lightweight Execution: Programmatic API for batch sentence and document translation.',
    ],
    challengesSolved: [
      {
        challenge: 'Structural Word Order Divergence',
        solution: 'Tuned multi-head cross-attention heads to map English Subject-Verb-Object (SVO) structures into natural Hindi Subject-Object-Verb (SOV) order.',
      },
      {
        challenge: 'Devanagari Unicode Inconsistencies',
        solution: 'Implemented strict Unicode normalization (NFC) prior to subword segmentation with SentencePiece.',
      },
    ],
    techStackGrouped: {
      languages: ['Python 3.10'],
      frameworks: ['PyTorch', 'Hugging Face Transformers'],
      backend: ['Python CLI & API'],
      tools: ['SentencePiece', 'Datasets', 'SacreBLEU'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# English–Hindi Translator\n\nNeural Machine Translation Pipeline.`,
      },
    },
  },

  // 6. ResQGrid (Other 1)
  {
    id: 'proj-6',
    slug: 'resqgrid',
    title: 'ResQGrid',
    tagline: 'Disaster response coordination and emergency resource grid mapping platform',
    featured: false,
    sortOrder: 6,
    status: 'Completed',
    category: 'Full-Stack Systems & Emergency Tech',
    repoUrl: 'https://github.com/shivansh-dhakad/ResQGrid',
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'React', 'TypeScript', 'HTML', 'CSS', 'JavaScript', 'Supabase'],
    whatItIs:
      'ResQGrid is a spatial disaster coordination web platform designed to synchronize emergency distress signals, volunteer dispatch, and relief supply distribution in real time during humanitarian crises.',
    whatIDeveloped: [
      'Interactive geospatial incident mapping interface with urgency color-coding and clustering.',
      'Role-based dispatch dashboard connecting field volunteers to verified emergency tasks.',
      'Resilient client-side offline queueing for responders operating in low-connectivity disaster zones.',
    ],
    mainFeatures: [
      'Live Geospatial Triage: Real-time map visualization of distress calls.',
      'Role-Based Dispatch: Separates emergency coordinators, field responders, and civilian requests.',
      'Low-Bandwidth Resilient: Offline caching and lightweight REST payload transfers.',
    ],
    challengesSolved: [
      {
        challenge: 'Real-Time Telemetry Synchronization',
        solution: 'Leveraged Supabase real-time channels and PostgreSQL subscriptions to broadcast distress status changes instantly to all connected dispatch screens.',
      },
    ],
    techStackGrouped: {
      languages: ['TypeScript', 'JavaScript', 'Python'],
      frameworks: ['React', 'HTML5', 'CSS3'],
      backend: ['Supabase', 'Node.js', 'REST APIs'],
      tools: ['Leaflet / Maps', 'PostgreSQL'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# ResQGrid\n\nEmergency Incident Response Grid.`,
      },
    },
  },

  // 7. Data Analysis and ML Website (Other 2)
  {
    id: 'proj-7',
    slug: 'data-analysis-ml-website',
    title: 'Data Analysis and ML Website',
    tagline: 'Interactive web platform for automated exploratory data analysis, visualization & ML training',
    featured: false,
    sortOrder: 7,
    status: 'Completed',
    category: 'Data Science & AutoML Tools',
    repoUrl: 'https://github.com/shivansh-dhakad/Data-analysis-and-ML-website',
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'Pandas', 'NumPy', 'Matplotlib', 'Seaborn', 'Scikit-Learn'],
    whatItIs:
      'An interactive automated data science web portal that allows users to upload any tabular dataset (CSV/Excel) to instantly generate exploratory summaries, correlation matrices, clean missing records, and benchmark baseline ML algorithms.',
    whatIDeveloped: [
      'Automated EDA engine calculating skewness, missing-value ratios, cardinality, and outlier boundaries.',
      'Visualization dashboard rendering multi-dimensional histograms, scatter matrices, and heatmaps.',
      'One-click machine learning training module evaluating regression and classification baselines with downloadable model weights.',
    ],
    mainFeatures: [
      'Instant Statistical Profiling: Full summary stats and distribution insights in seconds.',
      'Automated Data Cleansing: Missing value imputation, categorical encoding, and scaling.',
      'Model Benchmarking: Side-by-side performance metrics comparison for multiple algorithms.',
    ],
    challengesSolved: [
      {
        challenge: 'Arbitrary Data Schema Variations',
        solution: 'Built robust data type inference heuristics that handle mixed strings, dates, and currency symbols automatically.',
      },
    ],
    techStackGrouped: {
      languages: ['Python'],
      frameworks: ['Scikit-Learn'],
      backend: ['Streamlit / Web'],
      tools: ['Pandas', 'NumPy', 'Matplotlib', 'Seaborn'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# Data Analysis and ML Website\n\nAutomated Tabular EDA Studio.`,
      },
    },
  },

  // 8. NibandhAI (Other 3)
  {
    id: 'proj-8',
    slug: 'nibandhai',
    title: 'NibandhAI',
    tagline: 'AI-assisted essay structuring, semantic coherence analysis & bilingual writing engine',
    featured: false,
    sortOrder: 8,
    status: 'Completed',
    category: 'Natural Language Processing & Generative AI',
    repoUrl: 'https://github.com/shivansh-dhakad/NibandhAI',
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'Large Language Models', 'Flask', 'JavaScript', 'HTML', 'CSS'],
    whatItIs:
      'NibandhAI is an AI-powered academic and bilingual essay assistant designed to help students structure well-argued compositions, evaluate narrative transitions, and enrich English/Hindi vocabulary.',
    whatIDeveloped: [
      'Structured prompt-chaining architecture that outlines thesis propositions, argument evidence, and conclusions.',
      'Semantic coherence scoring algorithm identifying jarring topic shifts between paragraphs.',
      'Bilingual vocabulary suggestion mode providing contextual synonym recommendations.',
    ],
    mainFeatures: [
      'Structured Outline Generation: Logical multi-paragraph academic layouts.',
      'Paragraph Coherence Analysis: Evaluates smooth transitional phrases and syntactic flow.',
      'Bilingual Vocabulary Enrichment: Context-aware synonym expansions in Hindi and English.',
    ],
    challengesSolved: [
      {
        challenge: 'Maintaining Context Across Long Essays',
        solution: 'Implemented sliding window prompt chaining where previous paragraph summaries condition subsequent section generation.',
      },
    ],
    techStackGrouped: {
      languages: ['Python', 'JavaScript'],
      frameworks: ['Flask', 'HTML5', 'CSS3'],
      backend: ['Python REST API'],
      tools: ['Prompt Chaining', 'LLM APIs'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# NibandhAI\n\nBilingual Essay Structuring Engine.`,
      },
    },
  },

  // 9. Mobile Price Prediction (Other 4)
  {
    id: 'proj-9',
    slug: 'mobile-price-prediction',
    title: 'Mobile Price Prediction',
    tagline: 'Hardware specification-based mobile phone price bracket classification & regression pipeline',
    featured: false,
    sortOrder: 9,
    status: 'Completed',
    category: 'Machine Learning & Predictive Modeling',
    repoUrl: 'https://github.com/shivansh-dhakad/mobile-price-prediction',
    demoUrl: null,
    docsUrl: null,
    skills: ['Python', 'Scikit-Learn', 'Pandas', 'NumPy', 'Machine Learning'],
    whatItIs:
      'A machine learning predictive pipeline that classifies mobile phones into accurate market price tiers based on underlying hardware features such as RAM, processor speed, battery mAh, camera megapixels, and internal storage.',
    whatIDeveloped: [
      'Exploratory data analysis uncovering RAM capacity and battery power as primary price variance drivers.',
      'Data preprocessing pipeline with feature scaling, multi-class categorical encoding, and correlation pruning.',
      'Hyperparameter-tuned Support Vector Machine and Random Forest classification models.',
    ],
    mainFeatures: [
      'Specification-Based Tiering: Accurately maps hardware specs to market price tiers.',
      'Feature Importance Analysis: Identifies key hardware drivers of smartphone pricing.',
      'Cross-Validated Accuracy: Rigorous testing with Grid Search cross-validation.',
    ],
    challengesSolved: [
      {
        challenge: 'High Feature Dimension Correlation',
        solution: 'Used variance inflation factor (VIF) filtering to eliminate redundant hardware parameters before training.',
      },
    ],
    techStackGrouped: {
      languages: ['Python'],
      frameworks: ['Scikit-Learn'],
      backend: ['Python Scripts'],
      tools: ['Pandas', 'NumPy', 'Matplotlib'],
    },
    files: {
      'overview.md': {
        name: 'overview.md',
        language: 'markdown',
        content: `# Mobile Price Prediction\n\nHardware Tier Classification Pipeline.`,
      },
    },
  },
]

export const BEYOND_CODE_DATA: BeyondCodeItem[] = [
  {
    id: 'interest-flute',
    title: 'Flute Playing (Bansuri)',
    category: 'Acoustic Arts & Discipline',
    description: 'Playing the Indian bamboo flute (Bansuri) is my primary creative discipline outside of machine learning.',
    placeholderType: 'audio',
  },
  {
    id: 'interest-bike',
    title: 'Long-Distance Bike Riding',
    category: 'Endurance & Exploration',
    description: 'Cycling across long stretches and scenic routes around Madhya Pradesh provides an essential mental reset.',
    placeholderType: 'photo',
  },
]