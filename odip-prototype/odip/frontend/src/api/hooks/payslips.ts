import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient, apiGet } from '../client'
import { usePermissions } from '@/lib/permissions'
import type { PortalPayslipsDto } from '../types'

/**
 * The signed-in person's own payslips. Keyed by the user id and dropped the moment nothing watches it (gcTime 0), so a shared phone never
 * shows the last person's list. No retry: a failed Employment Hero call would otherwise be repeated three times into its rate limit.
 */
export function useMyPayslips() {
  const { id } = usePermissions()
  return useQuery({
    queryKey: ['portal-my-payslips', id],
    queryFn: () => apiGet<PortalPayslipsDto>('/portal/payslips'),
    gcTime: 0,
    retry: false,
  })
}

/** Saves one payslip's PDF through the browser, as the house blob pattern does (hooks/participants.ts). The file comes straight from Employment Hero and is not kept. */
export function useDownloadPayslip() {
  return useMutation({
    mutationFn: async ({ payRunId, datePaid }: { payRunId: number; datePaid: string | null }) => {
      const response = await apiClient.get<Blob>(`/portal/payslips/${payRunId}/pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `payslip-${datePaid ?? payRunId}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      // iOS needs the URL alive after the click (as ItineraryPdf does).
      setTimeout(() => window.URL.revokeObjectURL(url), 5000)
    },
  })
}
