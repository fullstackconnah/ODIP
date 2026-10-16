import { initEarlyAccessForm } from './form'
import { initPlatformFacts } from './platform'

const form = document.querySelector<HTMLFormElement>('#alpha-form')
if (form) initEarlyAccessForm(form)
initPlatformFacts()
