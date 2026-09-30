import { initEarlyAccessForm } from './form'
import { initScrollFrames } from './frames'
import { initMotion } from './motion'

document.documentElement.classList.add('js')

const form = document.querySelector<HTMLFormElement>('#early-access-form')
if (form) initEarlyAccessForm(form)

initScrollFrames()
initMotion()
