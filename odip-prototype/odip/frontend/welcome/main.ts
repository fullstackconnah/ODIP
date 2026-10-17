import { initEarlyAccessForm } from './form'
import { initDay } from './motion'
import { initPlatformFacts } from './platform'

// Form, then facts, then the day: a motion fault can't touch the form or the facts.
const form = document.querySelector<HTMLFormElement>('#alpha-form')
if (form) initEarlyAccessForm(form)
initPlatformFacts()
initDay()
