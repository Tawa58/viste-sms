import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from '@/components/shared/alert'
import { PageHeader } from '@/components/shared/page-header'
import { ProfilePhotoUpload } from '@/components/shared/profile-photo-upload'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth-context'
import { useTheme } from '@/contexts/theme-provider'
import {
  canManageSchoolSettings,
  defaultTitleForRole,
  formatRoleLabel,
  isStaffRole,
} from '@/lib/roles'
import { catalogService } from '@/services/api'
import { FEE_CATEGORIES, normalizeTermFees } from '@/lib/fees'
import type {
  AcademicYear,
  AuthUser,
  FeePolicy,
  GradingScalesBundle,
  GradingTrack,
  SchoolProfile,
  Term,
  TermFeeAmounts,
} from '@/types'

type ProfileForm = {
  name: string
  email: string
  phone: string
  title: string
  department: string
  employeeNumber: string
  bio: string
  preferredLanguage: 'en' | 'sn' | 'nd'
  timezone: string
  avatarUrl?: string
  avatarFileId?: string
  notifyEmail: boolean
  notifySms: boolean
  notifyInApp: boolean
  requireReauthForFees: boolean
}

function toForm(user: AuthUser): ProfileForm {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone ?? '',
    title: user.title ?? defaultTitleForRole(user.role),
    department: user.department ?? '',
    employeeNumber: user.employeeNumber ?? '',
    bio: user.bio ?? '',
    preferredLanguage: user.preferredLanguage ?? 'en',
    timezone: user.timezone ?? 'Africa/Harare',
    avatarUrl: user.avatarUrl ?? undefined,
    avatarFileId: user.avatarFileId ?? undefined,
    notifyEmail: user.notificationPrefs?.email ?? true,
    notifySms: user.notificationPrefs?.sms ?? false,
    notifyInApp: user.notificationPrefs?.inApp ?? true,
    requireReauthForFees: user.securityPrefs?.requireReauthForFees ?? false,
  }
}

export function SettingsPage() {
  const { user, updateProfile, changePassword } = useAuth()
  const [params, setParams] = useSearchParams()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    next: '',
    confirm: '',
  })

  const staff = user ? isStaffRole(user.role) : false
  const schoolAdmin = user ? canManageSchoolSettings(user.role) : false
  /** Title, department, and employee # are set by admin — teachers cannot change them. */
  const adminManagedHrFields = user?.role === 'TEACHER'

  const allowedTabs = useMemo(() => {
    const tabs = ['profile', 'notifications', 'security', 'appearance'] as const
    const extra: string[] = []
    if (user?.role === 'TEACHER') extra.push('teaching')
    if (user?.role === 'PARENT') extra.push('family')
    if (user?.role === 'STUDENT') extra.push('student')
    if (schoolAdmin) extra.push('school', 'academic', 'fees', 'grading')
    return [...tabs, ...extra]
  }, [schoolAdmin, user?.role])

  const activeTab = allowedTabs.includes(params.get('tab') ?? '')
    ? (params.get('tab') as string)
    : 'profile'

  useEffect(() => {
    if (user) setForm(toForm(user))
  }, [user])

  if (!user || !form) return null

  function setTab(tab: string) {
    setParams(tab === 'profile' ? {} : { tab })
  }

  async function saveProfile(partial?: Partial<ProfileForm>) {
    const nextForm = { ...form!, ...partial }
    setForm(nextForm)
    setSaving(true)
    try {
      await notify.process(
        () =>
          updateProfile({
            name: nextForm.name.trim(),
            email: nextForm.email.trim(),
            phone: nextForm.phone.trim() || undefined,
            title: adminManagedHrFields ? undefined : nextForm.title.trim() || undefined,
            department:
              adminManagedHrFields || !staff
                ? undefined
                : nextForm.department.trim() || undefined,
            employeeNumber:
              adminManagedHrFields || !staff
                ? undefined
                : nextForm.employeeNumber.trim() || undefined,
            bio: nextForm.bio.trim() || undefined,
            preferredLanguage: nextForm.preferredLanguage,
            timezone: nextForm.timezone,
            avatarUrl: nextForm.avatarUrl,
            notificationPrefs: {
              email: nextForm.notifyEmail,
              sms: nextForm.notifySms,
              inApp: nextForm.notifyInApp,
            },
            securityPrefs: {
              requireReauthForFees: nextForm.requireReauthForFees,
            },
          }),
        {
          loading: 'Saving profile…',
          success: 'Profile settings saved',
          error: 'Could not save settings',
        },
      )
    } catch {
      // toast already shown
    } finally {
      setSaving(false)
    }
  }

  async function savePhoto(next: { fileId: string; previewUrl: string } | undefined) {
    setForm((f) =>
      f
        ? {
            ...f,
            avatarUrl: next?.previewUrl,
            avatarFileId: next?.fileId,
          }
        : f,
    )
    setSaving(true)
    try {
      await notify.process(
        () =>
          updateProfile({
            avatarFileId: next?.fileId ?? null,
            avatarUrl: null,
          }),
        {
          loading: 'Saving photo…',
          success: 'Photo saved',
          error: 'Could not update photo',
        },
      )
    } catch {
      // toast already shown
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description={`Manage your ${formatRoleLabel(user.role).toLowerCase()} profile, preferences, and ${schoolAdmin ? 'school configuration' : 'account options'}.`}
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Settings' }]}
      />

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList className="mb-4 flex h-auto flex-wrap gap-1">
          <TabsTrigger value="profile">My profile</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          {user.role === 'TEACHER' && <TabsTrigger value="teaching">Teaching</TabsTrigger>}
          {user.role === 'PARENT' && <TabsTrigger value="family">Family</TabsTrigger>}
          {user.role === 'STUDENT' && <TabsTrigger value="student">Student</TabsTrigger>}
          {schoolAdmin && (
            <>
              <TabsTrigger value="school">School</TabsTrigger>
              <TabsTrigger value="academic">Academic</TabsTrigger>
              <TabsTrigger value="fees">Fees</TabsTrigger>
              <TabsTrigger value="grading">Grading</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Profile details</CardTitle>
                <CardDescription>
                  Fields shown depend on your role. Staff updates also sync to the staff directory when linked.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <ProfilePhotoUpload
                  name={form.name || user.name}
                  previewUrl={form.avatarUrl}
                  fileId={form.avatarFileId}
                  disabled={saving}
                  access={{
                    userId: user.id,
                    role: user.role,
                    staffId: user.staffId,
                    studentId: user.studentId,
                    guardianId: user.guardianId,
                  }}
                  ownerId={user.staffId ?? user.studentId ?? user.id}
                  ownerType={user.staffId ? 'staff' : user.studentId ? 'student' : 'user'}
                  fileType={user.staffId ? 'staff_photo' : 'profile_photo'}
                  hint="Upload a clear headshot — it shows on your profile and in staff lists."
                  onChange={(next) => void savePhoto(next)}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field className="sm:col-span-2">
                    <Label htmlFor="profile-name">Full name</Label>
                    <Input
                      id="profile-name"
                      value={form.name}
                      onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                    />
                  </Field>
                  <Field>
                    <Label htmlFor="profile-email">Work email</Label>
                    <Input
                      id="profile-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))}
                    />
                  </Field>
                  <Field>
                    <Label htmlFor="profile-phone">Phone</Label>
                    <Input
                      id="profile-phone"
                      value={form.phone}
                      onChange={(e) => setForm((f) => (f ? { ...f, phone: e.target.value } : f))}
                    />
                  </Field>
                  <Field>
                    <Label htmlFor="profile-title">Title / position</Label>
                    <Input
                      id="profile-title"
                      value={form.title}
                      disabled={adminManagedHrFields}
                      onChange={(e) => setForm((f) => (f ? { ...f, title: e.target.value } : f))}
                    />
                    {adminManagedHrFields ? (
                      <p className="text-xs text-muted-foreground">
                        Set by school admin (e.g. Science teacher) — not editable here.
                      </p>
                    ) : null}
                  </Field>
                  <Field>
                    <Label>Role</Label>
                    <Input value={formatRoleLabel(user.role)} disabled />
                  </Field>

                  {staff && (
                    <>
                      <Field>
                        <Label htmlFor="profile-dept">Department</Label>
                        <Input
                          id="profile-dept"
                          value={form.department}
                          disabled={adminManagedHrFields}
                          onChange={(e) =>
                            setForm((f) => (f ? { ...f, department: e.target.value } : f))
                          }
                        />
                        {adminManagedHrFields ? (
                          <p className="text-xs text-muted-foreground">
                            Set by school admin — not editable here.
                          </p>
                        ) : null}
                      </Field>
                      <Field>
                        <Label htmlFor="profile-emp">Employee number</Label>
                        <Input
                          id="profile-emp"
                          value={form.employeeNumber}
                          disabled={adminManagedHrFields}
                          onChange={(e) =>
                            setForm((f) => (f ? { ...f, employeeNumber: e.target.value } : f))
                          }
                        />
                        {adminManagedHrFields ? (
                          <p className="text-xs text-muted-foreground">
                            Set by school admin — not editable here.
                          </p>
                        ) : null}
                      </Field>
                    </>
                  )}

                  <Field>
                    <Label htmlFor="profile-lang">Preferred language</Label>
                    <Select
                      id="profile-lang"
                      value={form.preferredLanguage}
                      onChange={(e) =>
                        setForm((f) =>
                          f
                            ? {
                                ...f,
                                preferredLanguage: e.target.value as ProfileForm['preferredLanguage'],
                              }
                            : f,
                        )
                      }
                    >
                      <option value="en">English</option>
                      <option value="sn">Shona</option>
                      <option value="nd">Ndebele</option>
                    </Select>
                  </Field>
                  <Field>
                    <Label htmlFor="profile-tz">Timezone</Label>
                    <Select
                      id="profile-tz"
                      value={form.timezone}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, timezone: e.target.value } : f))
                      }
                    >
                      <option value="Africa/Harare">Africa/Harare</option>
                      <option value="Africa/Johannesburg">Africa/Johannesburg</option>
                      <option value="UTC">UTC</option>
                    </Select>
                  </Field>
                  <Field className="sm:col-span-2">
                    <Label htmlFor="profile-bio">About / notes</Label>
                    <Textarea
                      id="profile-bio"
                      rows={4}
                      value={form.bio}
                      onChange={(e) => setForm((f) => (f ? { ...f, bio: e.target.value } : f))}
                      placeholder="Short professional summary for your profile"
                    />
                  </Field>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setForm(toForm(user))}
                    disabled={saving}
                  >
                    Reset
                  </Button>
                  <Button disabled={saving} onClick={() => void saveProfile()}>
                    {saving ? 'Saving…' : 'Save profile'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Account summary</CardTitle>
                <CardDescription>What this role can manage in Settings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border border-border/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Signed in as</p>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-muted-foreground">{user.email}</p>
                </div>
                <div className="rounded-lg border border-border/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Role access</p>
                  <p className="font-medium">{formatRoleLabel(user.role)}</p>
                  <p className="mt-1 text-muted-foreground">
                    {schoolAdmin
                      ? 'Full school configuration, users, and personal profile.'
                      : staff
                        ? 'Staff profile, notifications, security, and teaching tools.'
                        : user.role === 'PARENT'
                          ? 'Family contacts, fee notices, and result alerts.'
                          : 'Student profile, result notices, and appearance.'}
                  </p>
                </div>
                {user.staffId && (
                  <Alert title="Linked staff record" tone="info">
                    Profile photo and contact details sync with Teachers & Staff ({user.staffId}).
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification preferences</CardTitle>
              <CardDescription>Choose how Viste contacts you for school updates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(
                [
                  ['notifyEmail', 'Email alerts', 'Receipts, announcements, and result releases'],
                  ['notifySms', 'SMS alerts', 'Urgent attendance and fee reminders'],
                  ['notifyInApp', 'In-app alerts', 'Dashboard and header notifications'],
                ] as const
              ).map(([key, label, hint]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <Switch
                    checked={form[key]}
                    onCheckedChange={(checked) =>
                      setForm((f) => (f ? { ...f, [key]: checked } : f))
                    }
                  />
                </div>
              ))}
              <div className="flex justify-end">
                <Button disabled={saving} onClick={() => void saveProfile()}>
                  Save notifications
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>
                Change your own password after signing in with an admin-issued temporary password.
                Admins never see the password you set here — use Forgot password on the login page
                if you lose it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2">
                  <Label>Current password</Label>
                  <Input
                    type="password"
                    value={passwordForm.current}
                    onChange={(e) =>
                      setPasswordForm((f) => ({ ...f, current: e.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <Label>New password</Label>
                  <Input
                    type="password"
                    value={passwordForm.next}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, next: e.target.value }))}
                  />
                </Field>
                <Field>
                  <Label>Confirm new password</Label>
                  <Input
                    type="password"
                    value={passwordForm.confirm}
                    onChange={(e) =>
                      setPasswordForm((f) => ({ ...f, confirm: e.target.value }))
                    }
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">Require re-authentication for fee actions</p>
                  <p className="text-xs text-muted-foreground">
                    Extra confirmation before recording or reversing payments
                  </p>
                </div>
                <Switch
                  checked={form.requireReauthForFees}
                  onCheckedChange={(checked) =>
                    setForm((f) => (f ? { ...f, requireReauthForFees: checked } : f))
                  }
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => void saveProfile()}
                >
                  Save security preference
                </Button>
                <Button
                  onClick={() => {
                    if (!passwordForm.current || !passwordForm.next) {
                      notify.error('Enter current and new passwords')
                      return
                    }
                    if (passwordForm.next.length < 8) {
                      notify.error('New password must be at least 8 characters')
                      return
                    }
                    if (passwordForm.next !== passwordForm.confirm) {
                      notify.error('New passwords do not match')
                      return
                    }
                    void (async () => {
                      try {
                        await notify.process(
                          () => changePassword(passwordForm.current, passwordForm.next),
                          {
                            loading: 'Updating password…',
                            success:
                              'Password updated. Your new password is private — only you can use it.',
                            error: 'Could not update password',
                          },
                        )
                        setPasswordForm({ current: '', next: '', confirm: '' })
                      } catch {
                        /* notify.process already surfaced */
                      }
                    })()
                  }}
                >
                  Update password
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>

        {user.role === 'TEACHER' && (
          <TabsContent value="teaching">
            <Card>
              <CardHeader>
                <CardTitle>Teaching preferences</CardTitle>
                <CardDescription>
                  Classroom defaults will connect to attendance and mark entry in a later update.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert title="Coming soon" tone="info">
                  Teaching preferences are not stored yet. Use Attendance and Results pages for daily
                  work.
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {user.role === 'PARENT' && (
          <TabsContent value="family">
            <Card>
              <CardHeader>
                <CardTitle>Family preferences</CardTitle>
                <CardDescription>
                  Use Notifications for contact channels. Family-specific options will follow.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert title="Use Notifications" tone="info">
                  Turn email, SMS, and in-app alerts on or off from the Notifications tab.
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {user.role === 'STUDENT' && (
          <TabsContent value="student">
            <Card>
              <CardHeader>
                <CardTitle>Student preferences</CardTitle>
                <CardDescription>
                  Result alerts follow your Notifications settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert title="Use Notifications" tone="info">
                  Enable in-app alerts on the Notifications tab to hear when results are published.
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {schoolAdmin ? (
          <TabsContent value="school">
            <SchoolProfilePanel />
          </TabsContent>
        ) : null}

        {schoolAdmin ? (
          <TabsContent value="academic">
            <AcademicSettingsPanel />
          </TabsContent>
        ) : null}

        {schoolAdmin ? (
          <TabsContent value="fees">
            <FeePolicyPanel />
          </TabsContent>
        ) : null}

        {schoolAdmin ? (
          <TabsContent value="grading">
            <GradingScalePanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}

function AppearancePanel() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose light, dark, or match your device. This preference stays on this browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field className="max-w-sm">
          <Label htmlFor="theme-mode">Theme</Label>
          <Select
            id="theme-mode"
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System ({resolvedTheme})</option>
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">
          You can also switch themes from the sun/moon control in the top bar.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setTheme('light')
            notify.success('Appearance reset to light mode')
          }}
        >
          Reset to light mode
        </Button>
      </CardContent>
    </Card>
  )
}

function SchoolProfilePanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Omit<SchoolProfile, 'id' | 'updatedAt' | 'updatedBy'> | null>(
    null,
  )

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const profile = await catalogService.getSchoolProfile()
        if (!mounted) return
        setForm({
          name: profile.name,
          motto: profile.motto ?? '',
          address: profile.address,
          phone: profile.phone,
          email: profile.email,
          website: profile.website ?? '',
          registrationNumber: profile.registrationNumber ?? '',
        })
      } catch (err) {
        console.error(err)
        notify.error('Could not load school profile')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function save() {
    if (!form) return
    if (!form.name.trim() || !form.address.trim() || !form.phone.trim() || !form.email.trim()) {
      notify.error('Name, address, phone, and email are required')
      return
    }
    setSaving(true)
    try {
      const next = await notify.process(() => catalogService.updateSchoolProfile(form), {
        loading: 'Saving school profile…',
        success: 'School profile saved',
        error: 'Could not save school profile',
      })
      setForm({
        name: next.name,
        motto: next.motto ?? '',
        address: next.address,
        phone: next.phone,
        email: next.email,
        website: next.website ?? '',
        registrationNumber: next.registrationNumber ?? '',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading || !form) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading school profile…</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>School profile</CardTitle>
        <CardDescription>
          Shown on reports, receipts, and school communications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <Label>School name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
            />
          </Field>
          <Field className="sm:col-span-2">
            <Label>Motto</Label>
            <Input
              value={form.motto ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, motto: e.target.value } : f))}
            />
          </Field>
          <Field className="sm:col-span-2">
            <Label>Address</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm((f) => (f ? { ...f, address: e.target.value } : f))}
            />
          </Field>
          <Field>
            <Label>Phone</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => (f ? { ...f, phone: e.target.value } : f))}
            />
          </Field>
          <Field>
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))}
            />
          </Field>
          <Field>
            <Label>Website</Label>
            <Input
              value={form.website ?? ''}
              onChange={(e) => setForm((f) => (f ? { ...f, website: e.target.value } : f))}
            />
          </Field>
          <Field>
            <Label>Registration number</Label>
            <Input
              value={form.registrationNumber ?? ''}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, registrationNumber: e.target.value } : f))
              }
            />
          </Field>
        </div>
        <Button loading={saving} onClick={() => void save()}>
          Save school profile
        </Button>
      </CardContent>
    </Card>
  )
}

function AcademicSettingsPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [year, setYear] = useState<AcademicYear | null>(null)
  const [terms, setTerms] = useState<Term[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const data = await catalogService.getAcademicSettings()
        if (!mounted) return
        setYear(data.year)
        setTerms(data.terms)
        setYears(data.years)
      } catch (err) {
        console.error(err)
        notify.error('Could not load academic settings')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function save() {
    if (!year) return
    setSaving(true)
    try {
      const next = await notify.process(
        () =>
          catalogService.updateAcademicSettings({
            year,
            terms: terms.map((t) => ({
              id: t.id,
              name: t.name,
              sequence: t.sequence,
              startDate: t.startDate,
              endDate: t.endDate,
            })),
          }),
        {
          loading: 'Saving academic calendar…',
          success: 'Academic calendar saved',
          error: 'Could not save academic settings',
        },
      )
      setYear(next.year)
      setTerms(next.terms)
      setYears(next.years)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !year) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading academic calendar…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Academic structure</CardTitle>
        <CardDescription>
          Current year and Term 1–3 dates used when creating classes and recording results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {years.length > 1 ? (
          <Alert title={`${years.length} academic years on record`} tone="info">
            You are editing the current year below. Older years remain available for historical
            classes.
          </Alert>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <Label>Year name</Label>
            <Input
              value={year.name}
              onChange={(e) => setYear((y) => (y ? { ...y, name: e.target.value } : y))}
            />
          </Field>
          <Field>
            <Label>Start date</Label>
            <Input
              type="date"
              value={year.startDate}
              onChange={(e) => setYear((y) => (y ? { ...y, startDate: e.target.value } : y))}
            />
          </Field>
          <Field>
            <Label>End date</Label>
            <Input
              type="date"
              value={year.endDate}
              onChange={(e) => setYear((y) => (y ? { ...y, endDate: e.target.value } : y))}
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Mark as current year</p>
              <p className="text-xs text-muted-foreground">
                New classes and registers use the current year by default
              </p>
            </div>
            <Switch
              checked={year.isCurrent}
              onCheckedChange={(checked) =>
                setYear((y) => (y ? { ...y, isCurrent: checked } : y))
              }
            />
          </div>
        </div>

        <div className="space-y-3">
          <Label>Terms</Label>
          {terms.map((term, index) => (
            <div
              key={term.id}
              className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr]"
            >
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Name</p>
                <Input
                  value={term.name}
                  onChange={(e) =>
                    setTerms((prev) =>
                      prev.map((t, i) => (i === index ? { ...t, name: e.target.value } : t)),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Start</p>
                <Input
                  type="date"
                  value={term.startDate}
                  onChange={(e) =>
                    setTerms((prev) =>
                      prev.map((t, i) =>
                        i === index ? { ...t, startDate: e.target.value } : t,
                      ),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">End</p>
                <Input
                  type="date"
                  value={term.endDate}
                  onChange={(e) =>
                    setTerms((prev) =>
                      prev.map((t, i) => (i === index ? { ...t, endDate: e.target.value } : t)),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <Button loading={saving} onClick={() => void save()}>
          Save academic calendar
        </Button>
      </CardContent>
    </Card>
  )
}

function feePolicyForm(policy: FeePolicy): Omit<FeePolicy, 'id' | 'updatedAt' | 'updatedBy'> {
  return {
    currency: policy.currency,
    receiptPrefix: policy.receiptPrefix,
    nextReceiptNumber: policy.nextReceiptNumber,
    blockResultsWhenFeesOutstanding: policy.blockResultsWhenFeesOutstanding,
    overdueGraceDays: policy.overdueGraceDays,
    termFees: normalizeTermFees(policy.termFees),
  }
}

function FeePolicyPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Omit<FeePolicy, 'id' | 'updatedAt' | 'updatedBy'> | null>(null)
  const [savedFees, setSavedFees] = useState<TermFeeAmounts | null>(null)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const policy = await catalogService.getFeePolicy()
        if (!mounted) return
        setForm(feePolicyForm(policy))
        setSavedFees(normalizeTermFees(policy.termFees))
      } catch (err) {
        console.error(err)
        notify.error('Could not load fee policy')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      const previousFees = savedFees
      const next = await notify.process(() => catalogService.updateFeePolicy(form), {
        loading: 'Saving fee policy…',
        success: 'Fee policy saved',
        error: 'Could not save fee policy',
      })
      setForm(feePolicyForm(next))
      setSavedFees(next.termFees)
      const feesChanged = FEE_CATEGORIES.some(
        (c) => next.termFees[c.value] !== previousFees?.[c.value],
      )
      if (
        feesChanged &&
        window.confirm(
          'Term fees changed. Bill all active students for the current term with the new amounts now?',
        )
      ) {
        const result = await notify.process(() => catalogService.billTerm(), {
          loading: 'Billing students…',
          success: 'Term invoices updated',
          error: 'Could not bill the term',
        })
        notify.success(
          `${result.termName}: ${result.created} new, ${result.updated} updated invoices`,
        )
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading || !form) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading fee policy…</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee policy</CardTitle>
        <CardDescription>
          Term fees by student type, currency, receipt numbering, and whether unpaid fees block
          results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-3">
          <div>
            <p className="text-sm font-medium">Term fees</p>
            <p className="text-xs text-muted-foreground">
              Billed per student each term. The fee follows the student type set when registering or
              editing a student; ECD to Grade 7 always pay the primary learner fee.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {FEE_CATEGORIES.map((category) => (
              <Field key={category.value}>
                <Label htmlFor={`term-fee-${category.value}`}>
                  {category.label} ({form.currency})
                </Label>
                <Input
                  id={`term-fee-${category.value}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.termFees[category.value] || ''}
                  placeholder="0.00"
                  onChange={(e) => {
                    const amount = Math.max(0, Number(e.target.value) || 0)
                    setForm((f) =>
                      f ? { ...f, termFees: { ...f.termFees, [category.value]: amount } } : f,
                    )
                  }}
                />
                <p className="text-xs text-muted-foreground">{category.hint}</p>
              </Field>
            ))}
          </div>
        </section>
        <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
          <Field>
            <Label>Currency</Label>
            <Select
              value={form.currency}
              onChange={(e) => setForm((f) => (f ? { ...f, currency: e.target.value } : f))}
            >
              <option value="USD">USD</option>
              <option value="ZWL">ZWL</option>
              <option value="ZAR">ZAR</option>
              <option value="GBP">GBP</option>
            </Select>
          </Field>
          <Field>
            <Label>Receipt prefix</Label>
            <Input
              value={form.receiptPrefix}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, receiptPrefix: e.target.value.toUpperCase() } : f))
              }
            />
          </Field>
          <Field>
            <Label>Next receipt number</Label>
            <Input
              type="number"
              min={1}
              value={form.nextReceiptNumber}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, nextReceiptNumber: Number(e.target.value) || 1 } : f,
                )
              }
            />
          </Field>
          <Field>
            <Label>Overdue grace (days)</Label>
            <Input
              type="number"
              min={0}
              max={365}
              value={form.overdueGraceDays}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, overdueGraceDays: Number(e.target.value) || 0 } : f,
                )
              }
            />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Block results when fees are outstanding</p>
            <p className="text-xs text-muted-foreground">
              Parents and students see a fees lock until balances are cleared
            </p>
          </div>
          <Switch
            checked={form.blockResultsWhenFeesOutstanding}
            onCheckedChange={(checked) =>
              setForm((f) =>
                f ? { ...f, blockResultsWhenFeesOutstanding: checked } : f,
              )
            }
          />
        </div>
        <Button loading={saving} onClick={() => void save()}>
          Save fee policy
        </Button>
      </CardContent>
    </Card>
  )
}

function GradingScalePanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [track, setTrack] = useState<GradingTrack>('FORM_1_4')
  const [scales, setScales] = useState<GradingScalesBundle | null>(null)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const data = await catalogService.getGradingScale()
        if (!mounted) return
        setScales(data)
      } catch (err) {
        console.error(err)
        notify.error('Could not load grading scales')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const active = scales?.[track]

  function updateActive(
    patch: Partial<{ passMark: number; bands: { grade: string; minPercent: number; maxPercent: number }[] }>,
  ) {
    if (!scales || !active) return
    setScales({
      ...scales,
      [track]: { ...active, ...patch },
    })
  }

  async function save() {
    if (!active) return
    const labels = active.bands.map((b) => b.grade.trim().toUpperCase()).filter(Boolean)
    if (labels.length < 1) {
      notify.error('Add at least one grade band')
      return
    }
    setSaving(true)
    try {
      const next = (await notify.process(
        () =>
          catalogService.updateGradingScale({
            track,
            passMark: active.passMark,
            bands: active.bands,
          }) as Promise<GradingScalesBundle>,
        {
          loading: `Saving ${active.label}…`,
          success: `${active.label} saved — monthly and term exams use these bands`,
          error: 'Could not save grading scale',
        },
      )) as GradingScalesBundle
      setScales(next)
    } finally {
      setSaving(false)
    }
  }

  function ensureStandardBands() {
    updateActive({
      bands: [
        { grade: 'A', minPercent: track === 'FORM_5_6' ? 75 : 80, maxPercent: 100 },
        { grade: 'B', minPercent: track === 'FORM_5_6' ? 65 : 70, maxPercent: track === 'FORM_5_6' ? 74 : 79 },
        { grade: 'C', minPercent: track === 'FORM_5_6' ? 55 : 60, maxPercent: track === 'FORM_5_6' ? 64 : 69 },
        { grade: 'D', minPercent: track === 'FORM_5_6' ? 45 : 50, maxPercent: track === 'FORM_5_6' ? 54 : 59 },
        { grade: 'E', minPercent: track === 'FORM_5_6' ? 35 : 40, maxPercent: track === 'FORM_5_6' ? 44 : 49 },
        { grade: 'U', minPercent: 0, maxPercent: track === 'FORM_5_6' ? 34 : 39 },
      ],
      passMark: 50,
    })
  }

  if (loading || !active) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading grading scales…</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>High school grading</CardTitle>
        <CardDescription>
          Set separate A–U percent bands for Form 1–4 and Form 5–6. Monthly tests and end-of-term
          exams assign letter grades from the scheme that matches the student&apos;s form.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['FORM_1_4', 'Form 1–4'],
              ['FORM_5_6', 'Form 5–6'],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={track === id ? 'default' : 'outline'}
              onClick={() => setTrack(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        <Alert title={active.label} tone="info">
          {track === 'FORM_1_4'
            ? 'Used for Form 1, 2, 3 and 4 classes (O-Level track).'
            : 'Used for Form 5 and 6 classes (A-Level track).'}
        </Alert>

        <Field className="max-w-xs">
          <Label>Pass mark (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={active.passMark}
            onChange={(e) => updateActive({ passMark: Number(e.target.value) })}
          />
        </Field>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Grade bands (A, B, C, D, E, U)</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={ensureStandardBands}>
                Reset A–U defaults
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  updateActive({
                    bands: [...active.bands, { grade: '', minPercent: 0, maxPercent: 0 }],
                  })
                }
              >
                Add band
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {active.bands.map((band, index) => (
              <div key={index} className="grid grid-cols-[80px_1fr_1fr_auto] gap-2">
                <Input
                  placeholder="A"
                  value={band.grade}
                  onChange={(e) =>
                    updateActive({
                      bands: active.bands.map((b, i) =>
                        i === index ? { ...b, grade: e.target.value.toUpperCase() } : b,
                      ),
                    })
                  }
                />
                <Input
                  type="number"
                  placeholder="Min %"
                  value={band.minPercent}
                  onChange={(e) =>
                    updateActive({
                      bands: active.bands.map((b, i) =>
                        i === index ? { ...b, minPercent: Number(e.target.value) } : b,
                      ),
                    })
                  }
                />
                <Input
                  type="number"
                  placeholder="Max %"
                  value={band.maxPercent}
                  onChange={(e) =>
                    updateActive({
                      bands: active.bands.map((b, i) =>
                        i === index ? { ...b, maxPercent: Number(e.target.value) } : b,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    updateActive({
                      bands: active.bands.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>

        <Button loading={saving} onClick={() => void save()}>
          Save {track === 'FORM_1_4' ? 'Form 1–4' : 'Form 5–6'} scale
        </Button>
      </CardContent>
    </Card>
  )
}
