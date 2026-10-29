import * as store from '../db.js'
import { api } from './api.js'
import { online } from './online.js'
import { createRacksService } from './racks.js'

export const racks = createRacksService({ store, api, isOnline: () => online.value })
