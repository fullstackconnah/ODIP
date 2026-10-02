import { initCanopy } from './canopy'
import { initCrossings } from './crossing'
import { initEarlyAccessForm } from './form'
import { initScrollFrames } from './frames'
import { initSections } from './sections'

document.documentElement.classList.add('js')

const form = document.querySelector<HTMLFormElement>('#early-access-form')
if (form) initEarlyAccessForm(form)

initScrollFrames()
initSections()
initCrossings()
initCanopy()
