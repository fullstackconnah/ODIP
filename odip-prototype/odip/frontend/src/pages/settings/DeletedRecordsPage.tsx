import { PageHeader } from '@/components/PageHeader'
import DeletedRecordsTab from './DeletedRecordsTab'
import { DELETED_RECORDS_INTRO } from './settingsSections'

/** /settings/deleted-records: the same list the Settings rail opens, at a link of its own. */
export default function DeletedRecordsPage() {
  return (
    <>
      <PageHeader title="Deleted records" subtitle={DELETED_RECORDS_INTRO} />
      <DeletedRecordsTab />
    </>
  )
}
