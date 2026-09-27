import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Package, Plus, Trash2, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { SearchInput } from '@/components/shared/search-input'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableShell,
} from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/contexts/auth-context'
import { useFileObjectUrl } from '@/hooks/use-file-object-url'
import { catalogService } from '@/services/api'
import { fileService } from '@/services/files'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'
import { notify } from '@/lib/notify'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { InventoryAssetStatus, InventoryItem } from '@/types'

const CATEGORIES = ['Equipment', 'ICT', 'Furniture', 'Sports', 'Vehicles', 'Consumables', 'Other']

const emptyForm = (): Partial<InventoryItem> => ({
  name: '',
  category: 'Equipment',
  sku: '',
  registrationNumber: '',
  quantity: 1,
  location: '',
  supplier: '',
  purchaseValue: 0,
  purchaseDate: new Date().toISOString().slice(0, 10),
  status: 'IN_STOCK',
  notes: '',
})

function ReceiptThumb({
  fileId,
  access,
}: {
  fileId?: string
  access: { userId: string; role: string } | null
}) {
  const { url } = useFileObjectUrl(fileId, access)
  if (!fileId) return <span className="text-xs text-muted-foreground">—</span>
  if (!url) return <span className="text-xs text-muted-foreground">…</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-block"
      onClick={(e) => {
        if (!isAndroidApp()) return
        e.preventDefault()
        void fetch(url)
          .then((r) => r.blob())
          .then((blob) => saveBlobInApp(blob, `receipt-${fileId}.${blob.type.split('/')[1] || 'jpg'}`))
      }}
    >
      <img src={url} alt="Receipt" className="h-10 w-10 rounded-md object-cover ring-1 ring-border" />
    </a>
  )
}

export function InventoryPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState<Partial<InventoryItem>>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const access = user
    ? { userId: user.id, role: user.role }
    : null

  async function reload() {
    const rows = await catalogService.getInventory()
    setItems(rows)
  }

  useEffect(() => {
    reload()
      .catch((err) => {
        console.error(err)
        notify.error('Could not load inventory')
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => statusFilter === 'all' || i.status === statusFilter)
      .filter((i) => {
        if (!q) return true
        return `${i.name} ${i.sku} ${i.registrationNumber || ''} ${i.category} ${i.location}`
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items, search, statusFilter])

  const totals = useMemo(() => {
    const active = items.filter((i) => i.status === 'IN_STOCK' || i.status === 'DISPATCHED')
    const stockValue = active.reduce((s, i) => s + (i.purchaseValue || 0) * Math.max(1, i.quantity || 1), 0)
    const sold = items.filter((i) => i.status === 'SOLD')
    const soldValue = sold.reduce((s, i) => s + (i.soldAmount ?? 0), 0)
    return {
      count: items.length,
      stockValue,
      soldCount: sold.length,
      soldValue,
      dispatched: items.filter((i) => i.status === 'DISPATCHED').length,
    }
  }, [items])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(item: InventoryItem) {
    setEditing(item)
    setForm({ ...item })
    setOpen(true)
  }

  async function uploadReceipt(file: File | undefined) {
    if (!file || !user) return
    setUploading(true)
    try {
      const ownerId = editing?.id || `inv-temp-${user.id}`
      const result = await notify.process(
        () =>
          fileService.uploadFile(
            {
              file,
              fileType: 'school_document',
              ownerId,
              ownerType: 'school',
              uploadedBy: user.id,
              compressImage: true,
            },
            { userId: user.id, role: user.role },
          ),
        { loading: 'Uploading receipt…', success: 'Receipt saved' },
      )
      setForm((f) => ({ ...f, receiptFileId: result.metadata.id }))
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    if (!form.name?.trim()) {
      notify.error('Asset name is required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category || 'Other',
        sku: form.sku || '',
        registrationNumber: form.registrationNumber || '',
        quantity: Number(form.quantity) || 1,
        location: form.location || '',
        supplier: form.supplier || '',
        purchaseValue: Number(form.purchaseValue) || 0,
        purchaseDate: form.purchaseDate || new Date().toISOString().slice(0, 10),
        receiptFileId: form.receiptFileId || '',
        status: (form.status || 'IN_STOCK') as InventoryAssetStatus,
        dispatchedTo: form.dispatchedTo || '',
        dispatchedAt: form.dispatchedAt || '',
        soldAmount: form.soldAmount,
        soldAt: form.soldAt || '',
        notes: form.notes || '',
      }
      if (editing) {
        await catalogService.updateInventoryItem(editing.id, payload)
        notify.success('Asset updated')
      } else {
        await catalogService.createInventoryItem(payload)
        notify.success('Asset registered')
      }
      setOpen(false)
      await reload()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not save asset')
    } finally {
      setSaving(false)
    }
  }

  async function remove(item: InventoryItem) {
    if (!window.confirm(`Delete “${item.name}”?`)) return
    try {
      await catalogService.deleteInventoryItem(item.id)
      notify.success('Asset removed')
      await reload()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  if (loading) return <LoadingState message="Loading inventory…" />

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Register school assets with purchase value, registration numbers, and receipt photos."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Inventory' }]}
        actions={
          <Button type="button" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Register asset
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard label="Assets on record" value={String(totals.count)} icon={Package} compact />
        <StatCard
          label="Active asset value"
          value={formatCurrency(totals.stockValue)}
          hint="In stock + dispatched (purchase value × qty)"
          icon={Wallet}
          tone="accent"
          compact
        />
        <StatCard
          label="Dispatched"
          value={String(totals.dispatched)}
          icon={Package}
          tone="warning"
          compact
        />
        <StatCard
          label="Sold proceeds"
          value={formatCurrency(totals.soldValue)}
          hint={`${totals.soldCount} sold`}
          icon={Wallet}
          tone="success"
          compact
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput
          id="inv-search"
          name="inv-search"
          value={search}
          onChange={setSearch}
          placeholder="Search name, reg no, SKU…"
          className="min-w-[220px] flex-1"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-44"
        >
          <option value="all">All statuses</option>
          <option value="IN_STOCK">In stock</option>
          <option value="DISPATCHED">Dispatched</option>
          <option value="SOLD">Sold</option>
          <option value="WRITTEN_OFF">Written off</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No assets match. Register school assets to track value and receipts.
        </p>
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Asset</DataTableHeaderCell>
                <DataTableHeaderCell>Reg / SKU</DataTableHeaderCell>
                <DataTableHeaderCell>Qty</DataTableHeaderCell>
                <DataTableHeaderCell>Purchase</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell>Receipt</DataTableHeaderCell>
                <DataTableHeaderCell />
              </tr>
            </DataTableHead>
            <DataTableBody>
              {filtered.map((item) => (
                <DataTableRow key={item.id}>
                  <DataTableCell>
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => openEdit(item)}
                    >
                      {item.name}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {item.category}
                      {item.location ? ` · ${item.location}` : ''}
                    </p>
                  </DataTableCell>
                  <DataTableCell className="text-sm">
                    <div>{item.registrationNumber || '—'}</div>
                    <div className="text-xs text-muted-foreground">{item.sku}</div>
                  </DataTableCell>
                  <DataTableCell>{item.quantity}</DataTableCell>
                  <DataTableCell className="text-sm">
                    <div>{formatCurrency(item.purchaseValue || 0)}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.purchaseDate ? formatDate(item.purchaseDate) : '—'}
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={item.status} />
                    {item.status === 'SOLD' && item.soldAmount != null ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sold {formatCurrency(item.soldAmount)}
                        {item.soldAt ? ` · ${formatDate(item.soldAt)}` : ''}
                      </p>
                    ) : null}
                    {item.status === 'DISPATCHED' && item.dispatchedTo ? (
                      <p className="mt-1 text-xs text-muted-foreground">To {item.dispatchedTo}</p>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    <ReceiptThumb fileId={item.receiptFileId} access={access} />
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => openEdit(item)}>
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void remove(item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </DataTableShell>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit asset' : 'Register asset'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <Label>Name</Label>
              <Input
                value={form.name || ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Category</Label>
              <Select
                value={form.category || 'Equipment'}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Status</Label>
              <Select
                value={form.status || 'IN_STOCK'}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as InventoryAssetStatus }))
                }
              >
                <option value="IN_STOCK">In stock</option>
                <option value="DISPATCHED">Dispatched</option>
                <option value="SOLD">Sold</option>
                <option value="WRITTEN_OFF">Written off</option>
              </Select>
            </Field>
            <Field>
              <Label>Registration / serial</Label>
              <Input
                value={form.registrationNumber || ''}
                onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>SKU</Label>
              <Input
                value={form.sku || ''}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Quantity</Label>
              <Input
                type="number"
                min={0}
                value={form.quantity ?? 1}
                onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
              />
            </Field>
            <Field>
              <Label>Purchase value</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.purchaseValue ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, purchaseValue: Number(e.target.value) }))}
              />
            </Field>
            <Field>
              <Label>Purchase date</Label>
              <Input
                type="date"
                value={form.purchaseDate || ''}
                onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Location</Label>
              <Input
                value={form.location || ''}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Supplier</Label>
              <Input
                value={form.supplier || ''}
                onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
              />
            </Field>
            {form.status === 'DISPATCHED' ? (
              <>
                <Field>
                  <Label>Dispatched to</Label>
                  <Input
                    value={form.dispatchedTo || ''}
                    onChange={(e) => setForm((f) => ({ ...f, dispatchedTo: e.target.value }))}
                  />
                </Field>
                <Field>
                  <Label>Dispatch date</Label>
                  <Input
                    type="date"
                    value={form.dispatchedAt || ''}
                    onChange={(e) => setForm((f) => ({ ...f, dispatchedAt: e.target.value }))}
                  />
                </Field>
              </>
            ) : null}
            {form.status === 'SOLD' ? (
              <>
                <Field>
                  <Label>Sale amount</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.soldAmount ?? 0}
                    onChange={(e) => setForm((f) => ({ ...f, soldAmount: Number(e.target.value) }))}
                  />
                </Field>
                <Field>
                  <Label>Sale date</Label>
                  <Input
                    type="date"
                    value={form.soldAt || ''}
                    onChange={(e) => setForm((f) => ({ ...f, soldAt: e.target.value }))}
                  />
                </Field>
              </>
            ) : null}
            <Field className="sm:col-span-2">
              <Label>Receipt photo</Label>
              <div className="flex flex-wrap items-center gap-3">
                <ReceiptThumb fileId={form.receiptFileId} access={access} />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => void uploadReceipt(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading || !user}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  {form.receiptFileId ? 'Replace receipt' : 'Upload receipt'}
                </Button>
              </div>
            </Field>
            <Field className="sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={form.notes || ''}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
