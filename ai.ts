import { OpenAI } from 'openai'
import 'dotenv/config'

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.ENDPOINT,
  timeout: 10000,
})
