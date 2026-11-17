import { PROFILE_DATA } from './portfolioData'

export const fallbackProfile = {
  full_name: PROFILE_DATA.fullName,
  headline: PROFILE_DATA.headline,
  intro: PROFILE_DATA.intro,
  photo_url: PROFILE_DATA.photoUrl,
  github_url: PROFILE_DATA.githubUrl,
  linkedin_url: PROFILE_DATA.linkedinUrl,
  resume_url: PROFILE_DATA.resumeUrl,
}

export type Profile = typeof fallbackProfile
