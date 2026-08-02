export interface ApiResponse<T> {
  success: boolean
  data: T | null
  message: string | null
  errors: string[] | null
}

export interface PagedResult<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}
