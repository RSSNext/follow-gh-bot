import { OpenAI } from 'openai'
import 'dotenv/config'
// OpenAI API 配置
export const openai = new OpenAI({
  // apiKey: process.env.OPENAI_API_KEY,
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.ENDPOINT,
})
