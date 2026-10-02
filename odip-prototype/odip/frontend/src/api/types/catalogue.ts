import type { ClaimDayType } from './enums'

/** The price layout of an uploaded catalogue workbook: 2026-27 (National / Remote / Very Remote) or 2025-26 (one column per state). */
export type CatalogueFileFormat = 'NationalRemote' | 'StateColumns'
/** The catalogue's "Type" column; a blank cell is left out (null). */
export type CatalogueItemType = 'Priced' | 'Quotable' | 'UnitPriceOne'
/** A claim-flag cell (Y / N / NA); a blank cell is left out. */
export type CatalogueClaimFlag = 'No' | 'Yes' | 'NotApplicable'

export interface SupportActivityGroupDto {
  id: string
  groupCode: string
  displayName: string
  supportCategory: number
  isActive: boolean
  items: SupportCatalogueItemDto[]
}

export interface SupportCatalogueItemDto {
  id: string
  itemNumber: string
  description: string
  unit: string
  dayType: ClaimDayType
  isIntensive: boolean
  priceLimit_ACT: number
  priceLimit_NSW: number
  priceLimit_NT: number
  priceLimit_QLD: number
  priceLimit_SA: number
  priceLimit_TAS: number
  priceLimit_VIC: number
  priceLimit_WA: number
  priceLimit_Remote: number
  priceLimit_VeryRemote: number
  catalogueVersion: string
  effectiveFrom: string
  /** Absent = open-ended. */
  effectiveTo?: string
  isActive: boolean
  // What the 2026-27 catalogue holds. Absent on a row imported before it. The zone prices are the truth; priceLimit_* above are the 2025-26 shape.
  registrationGroup?: string
  supportCategoryNumber?: number
  paceSupportCategoryNumber?: number
  outcomeDomain?: number
  supportPurpose?: number
  catalogueType?: CatalogueItemType
  nonFaceToFace?: CatalogueClaimFlag
  providerTravel?: CatalogueClaimFlag
  shortNoticeCancellation?: CatalogueClaimFlag
  ndiaRequestedReports?: CatalogueClaimFlag
  irregularSil?: CatalogueClaimFlag
  isLegacy: boolean
  /** Absent on a quotable item (no price limit). */
  priceNational?: number
  /** Absent = the item is not eligible for remote loading. */
  priceRemote?: number
  /** Absent = the item is not eligible for very remote loading. */
  priceVeryRemote?: number
  sourceDocument?: string
}

export interface CatalogueImportPreviewDto {
  /** Proposed from the file's own start dates (for example "2026-27"). */
  detectedVersion: string
  detectedFormat: CatalogueFileFormat
  /** The uploaded file's name. */
  sourceDocument: string
  /** The earliest start date in the file (yyyy-MM-dd). */
  effectiveFrom?: string
  itemsToAdd: number
  /** Rows already in the database exactly as the file has them. */
  itemsUnchanged: number
  /** Rows on the file's Legacy sheet. */
  legacyItems: number
  /** Existing rows this import end-dates (never deletes). */
  itemsToDeactivate: number
  rows: CatalogueImportRowDto[]
  warnings: string[]
}

/**
 * A row as the API sends it, and as the confirm step must post it back: the server leaves defaults (false, 0) and nulls out of the JSON, so most
 * fields are optional. The server recomputes dayType, isIntensive, family and groupCode from the item number on confirm.
 */
export interface CatalogueImportRowDto {
  itemNumber: string
  description: string
  dayType: ClaimDayType
  isIntensive?: boolean
  priceLimit_ACT?: number
  priceLimit_NSW?: number
  priceLimit_NT?: number
  priceLimit_QLD?: number
  priceLimit_SA?: number
  priceLimit_TAS?: number
  priceLimit_VIC?: number
  priceLimit_WA?: number
  priceLimit_Remote?: number
  priceLimit_VeryRemote?: number
  isNew?: boolean
  priceChanged?: boolean
  isUnchanged?: boolean
  unit: string
  registrationGroup?: string
  supportCategoryNumber?: number
  paceSupportCategoryNumber?: number
  outcomeDomain?: number
  supportPurpose?: number
  catalogueType?: CatalogueItemType
  nonFaceToFace?: CatalogueClaimFlag
  providerTravel?: CatalogueClaimFlag
  shortNoticeCancellation?: CatalogueClaimFlag
  ndiaRequestedReports?: CatalogueClaimFlag
  irregularSil?: CatalogueClaimFlag
  isLegacy?: boolean
  /** The row's own start date (yyyy-MM-dd) from the file. */
  effectiveFrom: string
  /** The row's own end date; absent = open-ended. */
  effectiveTo?: string
  priceNational?: number
  priceRemote?: number
  priceVeryRemote?: number
  sourceDocument: string
  family: string
  groupCode: string
}

export interface ConfirmCatalogueImportDto {
  catalogueVersion: string
  rows: CatalogueImportRowDto[]
}
