import React, { Suspense } from 'react'
import { Route, Navigate, Outlet, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePermissions, type PageKey } from './lib/permissions'
import AppLayout from './components/layout/AppLayout'
import './index.css'

const LoginPage = React.lazy(() => import('./pages/LoginPage'))
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'))
const TripsPage = React.lazy(() => import('./pages/TripsPage'))
const TripDetailPage = React.lazy(() => import('./pages/TripDetailPage'))
const TripCreatePage = React.lazy(() => import('./pages/TripCreatePage'))
const ParticipantsPage = React.lazy(() => import('./pages/ParticipantsPage'))
const ParticipantCreatePage = React.lazy(() => import('./pages/ParticipantCreatePage'))
const ParticipantDetailPage = React.lazy(() => import('./pages/ParticipantDetailPage'))
const AccommodationPage = React.lazy(() => import('./pages/AccommodationPage'))
const AccommodationDetailPage = React.lazy(() => import('./pages/AccommodationDetailPage'))
const AccommodationCreatePage = React.lazy(() => import('./pages/AccommodationCreatePage'))
const VehiclesPage = React.lazy(() => import('./pages/VehiclesPage'))
const VehicleCreatePage = React.lazy(() => import('./pages/VehicleCreatePage'))
const StaffPage = React.lazy(() => import('./pages/StaffPage'))
const StaffCreatePage = React.lazy(() => import('./pages/StaffCreatePage'))
const TasksPage = React.lazy(() => import('./pages/TasksPage'))
const TaskCreatePage = React.lazy(() => import('./pages/TaskCreatePage'))
const IncidentsPage = React.lazy(() => import('./pages/IncidentsPage'))
const IncidentCreatePage = React.lazy(() => import('./pages/IncidentCreatePage'))
const BookingsPage = React.lazy(() => import('./pages/BookingsPage'))
const SchedulePage = React.lazy(() => import('./pages/SchedulePage'))
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'))
const QualificationsPage = React.lazy(() => import('./pages/QualificationsPage'))
const ClaimDetailPage = React.lazy(() => import('./pages/ClaimDetailPage'))
const BillingPage = React.lazy(() => import('@/pages/BillingPage'))
const ClaimBatchDetailPage = React.lazy(() => import('@/pages/ClaimBatchDetailPage'))
const ClaimBatchBuilderPage = React.lazy(() => import('@/pages/ClaimBatchBuilderPage'))
const RosterBoardPage = React.lazy(() => import('@/pages/rostering/RosterBoardPage'))
const PatternsPage = React.lazy(() => import('@/pages/rostering/PatternsPage'))
const CompatibilityPage = React.lazy(() => import('@/pages/rostering/CompatibilityPage'))
const MedicationsPage = React.lazy(() => import('@/pages/MedicationsPage'))
const MedicationFormPage = React.lazy(() => import('@/pages/MedicationFormPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function PrivateRoute({ children, page, requiresWrite }: { children: React.ReactNode; page?: PageKey; requiresWrite?: boolean }) {
  const token = localStorage.getItem('odip_token')
  const permissions = usePermissions()
  if (!token) return <Navigate to="/login" replace />
  if (page && !permissions.canAccessPage(page)) return <Navigate to="/" replace />
  if (requiresWrite && !permissions.canWrite) return <Navigate to="/" replace />
  return <>{children}</>
}

// A data router is required for react-router 7's useBlocker (used by
// useUnsavedChangesWarning) to work — it throws under the plain declarative
// <BrowserRouter>/<Routes> setup. createRoutesFromElements lets us build the
// route tree with the same JSX shape as before, just handed to
// createBrowserRouter instead of rendered directly.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Suspense fallback={<div className="flex items-center justify-center h-screen text-[#43493a]">Loading...</div>}><Outlet /></Suspense>}>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ErrorBoundary><PrivateRoute><AppLayout /></PrivateRoute></ErrorBoundary>}>
        <Route path="/" element={<PrivateRoute page="dashboard"><DashboardPage /></PrivateRoute>} />
        <Route path="/trips" element={<PrivateRoute page="trips"><TripsPage /></PrivateRoute>} />
        <Route path="/trips/new" element={<PrivateRoute page="trips" requiresWrite><TripCreatePage /></PrivateRoute>} />
        <Route path="/trips/:id" element={<PrivateRoute page="trips"><TripDetailPage /></PrivateRoute>} />
        <Route path="/schedule" element={<PrivateRoute page="schedule"><SchedulePage /></PrivateRoute>} />
        <Route path="/participants" element={<PrivateRoute page="participants"><ParticipantsPage /></PrivateRoute>} />
        <Route path="/participants/new" element={<PrivateRoute page="participants" requiresWrite><ParticipantCreatePage /></PrivateRoute>} />
        <Route path="/participants/:id" element={<PrivateRoute page="participants"><ParticipantDetailPage /></PrivateRoute>} />
        <Route path="/participants/:id/edit" element={<PrivateRoute page="participants" requiresWrite><ParticipantCreatePage /></PrivateRoute>} />
        <Route path="/accommodation" element={<PrivateRoute page="accommodation"><AccommodationPage /></PrivateRoute>} />
        <Route path="/accommodation/new" element={<PrivateRoute page="accommodation"><AccommodationCreatePage /></PrivateRoute>} />
        <Route path="/accommodation/:id" element={<PrivateRoute page="accommodation"><AccommodationDetailPage /></PrivateRoute>} />
        <Route path="/accommodation/:id/edit" element={<PrivateRoute page="accommodation"><AccommodationCreatePage /></PrivateRoute>} />
        <Route path="/vehicles" element={<PrivateRoute page="vehicles"><VehiclesPage /></PrivateRoute>} />
        <Route path="/vehicles/new" element={<PrivateRoute page="vehicles"><VehicleCreatePage /></PrivateRoute>} />
        <Route path="/vehicles/:id/edit" element={<PrivateRoute page="vehicles"><VehicleCreatePage /></PrivateRoute>} />
        <Route path="/staff" element={<PrivateRoute page="staff"><StaffPage /></PrivateRoute>} />
        <Route path="/staff/new" element={<PrivateRoute page="staff"><StaffCreatePage /></PrivateRoute>} />
        <Route path="/staff/:id/edit" element={<PrivateRoute page="staff"><StaffCreatePage /></PrivateRoute>} />
        <Route path="/tasks" element={<PrivateRoute page="tasks"><TasksPage /></PrivateRoute>} />
        <Route path="/tasks/new" element={<PrivateRoute page="tasks" requiresWrite><TaskCreatePage /></PrivateRoute>} />
        <Route path="/tasks/:id/edit" element={<PrivateRoute page="tasks" requiresWrite><TaskCreatePage /></PrivateRoute>} />
        <Route path="/incidents" element={<PrivateRoute page="incidents"><IncidentsPage /></PrivateRoute>} />
        <Route path="/incidents/new" element={<PrivateRoute page="incidents"><IncidentCreatePage /></PrivateRoute>} />
        <Route path="/incidents/:id/edit" element={<PrivateRoute page="incidents"><IncidentCreatePage /></PrivateRoute>} />
        <Route path="/bookings" element={<PrivateRoute page="bookings"><BookingsPage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute page="settings"><SettingsPage /></PrivateRoute>} />
        <Route path="/qualifications" element={<PrivateRoute page="qualifications"><QualificationsPage /></PrivateRoute>} />
        <Route path="/claims/:id" element={<PrivateRoute page="claims"><ClaimDetailPage /></PrivateRoute>} />
        <Route path="/billing" element={<PrivateRoute page="billing"><BillingPage /></PrivateRoute>} />
        <Route path="/billing/claim-batches/new" element={<PrivateRoute page="billing" requiresWrite><ClaimBatchBuilderPage /></PrivateRoute>} />
        <Route path="/billing/claim-batches/:id" element={<PrivateRoute page="billing"><ClaimBatchDetailPage /></PrivateRoute>} />
        <Route path="/rostering" element={<PrivateRoute page="rostering"><RosterBoardPage /></PrivateRoute>} />
        <Route path="/rostering/patterns" element={<PrivateRoute page="rostering"><PatternsPage /></PrivateRoute>} />
        <Route path="/rostering/compatibility" element={<PrivateRoute page="rostering"><CompatibilityPage /></PrivateRoute>} />
        <Route path="/medications" element={<PrivateRoute page="medications"><MedicationsPage /></PrivateRoute>} />
        <Route path="/medications/new" element={<PrivateRoute page="medications" requiresWrite><MedicationFormPage /></PrivateRoute>} />
        <Route path="/medications/:id/edit" element={<PrivateRoute page="medications" requiresWrite><MedicationFormPage /></PrivateRoute>} />
      </Route>
    </Route>
  )
)

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
