import { initializeApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const requiredEnvVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const

export const devAuthEnabled = import.meta.env.VITE_DEV_AUTH === 'true'

const missingEnvVars = requiredEnvVars.filter(key => !import.meta.env[key])

if (missingEnvVars.length > 0 && !devAuthEnabled) {
  throw new Error(
    `Missing required environment variable: ${missingEnvVars[0]}. Check your .env file.`
  )
}

let auth: Auth | null = null

if (missingEnvVars.length === 0) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  }

  const app = initializeApp(firebaseConfig)
  auth = getAuth(app)
}

export { auth }
