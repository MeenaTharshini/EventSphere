
import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  ListFilter,
  MapPin,
  RefreshCw,
  Users,
  Wallet,
  Building2,
  TrendingUp,
  ClipboardList,
  Clock3,
  BriefcaseBusiness,
  PieChart as PieChartIcon,
  Search,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiRequest, getEvents, getSponsorships } from "./api";
import "./Reports.css";

const PERIOD_OPTIONS = [
  { value: "6m", label: "Last 6 Months" },
  { value: "this-month", label: "This Month" },
  { value: "1m", label: "Past 1 Month" },
  { value: "3m", label: "Past 3 Months" },
  { value: "this-year", label: "This Year" },
  { value: "all", label: "All Time" },
];

const REPORT_OPTIONS = [
  { value: "event", label: "Event Performance Report" },
  { value: "attendee", label: "Attendee Registration Report" },
  { value: "budget", label: "Budget Report" },
  { value: "vendor", label: "Vendor Performance Report" },
  { value: "all", label: "Complete EventSphere Report" },
];

const COLORS = [
  "#7047eb",
  "#3c82f6",
  "#10b981",
  "#f59e0b",
  "#f97316",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
];

const TABS = [
  { id: "event", label: "Event Performance", icon: BarChart3 },
  { id: "attendee", label: "Attendee Reports", icon: Users },
  { id: "budget", label: "Budget Reports", icon: IndianRupee },
  { id: "vendor", label: "Vendor Performance", icon: BriefcaseBusiness },
];

function asArray(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;

  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
    if (Array.isArray(value?.data?.[key])) return value.data[key];
  }

  return [];
}

function idOf(value) {
  return String(
    value?.id ??
    value?._id ??
    value?.event_id ??
    value?.eventId ??
    ""
  );
}

function vendorIdOf(value) {
  return String(
    value?.vendor_id ??
    value?.vendorId ??
    value?.id ??
    value?._id ??
    value?.vendor?._id ??
    value?.vendor?.id ??
    ""
  );
}

function parseDate(value) {
  if (!value) return null;

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);

  const date = match
    ? new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
      )
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function eventDate(event) {
  return parseDate(
    event?.event_date ??
    event?.date ??
    event?.start_date ??
    event?.startDate
  );
}

function eventEndDate(event) {
  return (
    parseDate(
      event?.end_date ??
      event?.event_end_date ??
      event?.endDate
    ) ?? eventDate(event)
  );
}

function getPeriodBounds(period) {
  if (period === "all") return null;

  const now = new Date();
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );

  if (period === "this-month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      ),
    };
  }

  if (period === "this-year") {
    return {
      start: new Date(now.getFullYear(), 0, 1),
      end: new Date(
        now.getFullYear(),
        11,
        31,
        23,
        59,
        59,
        999
      ),
    };
  }

  const months = Number(period.replace("m", ""));
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);

  return {
    start: new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate()
    ),
    end,
  };
}

function isInPeriod(event, bounds) {
  if (!bounds) return true;

  const start = eventDate(event);
  const end = eventEndDate(event);

  return Boolean(
    start &&
    end &&
    start <= bounds.end &&
    end >= bounds.start
  );
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function formatDate(value) {
  const date = value instanceof Date ? value : parseDate(value);

  if (!date) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function eventName(event) {
  return (
    event?.name ??
    event?.title ??
    event?.event_name ??
    event?.eventName ??
    "Untitled event"
  );
}

function eventVenue(event) {
  const venue = event?.venue;

  if (typeof venue === "string") return venue;

  return (
    venue?.name ??
    event?.venue_name ??
    event?.venueName ??
    event?.location ??
    "Unspecified venue"
  );
}

function eventCategory(event) {
  return (
    event?.event_type ??
    event?.category ??
    event?.type ??
    "Uncategorized"
  );
}

function getEventStatus(event) {
  const stored = String(event?.status ?? "").toLowerCase();

  if (stored.includes("cancel")) return "Cancelled";
  if (stored.includes("complete")) return "Completed";

  const start = eventDate(event);
  if (!start) return "Scheduled";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = eventEndDate(event) ?? start;

  if (end < today) return "Completed";
  if (start > today) return "Upcoming";

  return "Ongoing";
}

function attendeeName(attendee) {
  return (
    attendee?.name ??
    attendee?.full_name ??
    attendee?.attendee_name ??
    attendee?.attendeeName ??
    attendee?.user?.name ??
    "Unknown attendee"
  );
}

function attendeeEmail(attendee) {
  return (
    attendee?.email ??
    attendee?.attendee_email ??
    attendee?.user?.email ??
    "—"
  );
}

function ticketStatus(attendee) {
  return (
    attendee?.ticket?.status ??
    attendee?.ticket_status ??
    attendee?.ticketStatus ??
    (attendee?.ticket ? "Issued" : "No ticket")
  );
}

function checkedIn(attendee) {
  const status = String(ticketStatus(attendee)).toLowerCase();

  return Boolean(
    attendee?.ticket?.checked_in_at ||
    attendee?.ticket?.checkedInAt ||
    attendee?.ticket?.checked_in ||
    attendee?.ticket?.is_checked_in ||
    attendee?.checked_in_at ||
    attendee?.checkedInAt ||
    attendee?.checked_in ||
    attendee?.is_checked_in ||
    ["used", "checked_in", "attended"].includes(status)
  );
}

function checkedInDate(attendee) {
  return (
    attendee?.ticket?.checked_in_at ??
    attendee?.ticket?.checkedInAt ??
    attendee?.checked_in_at ??
    attendee?.checkedInAt ??
    null
  );
}

function expenseStatus(expense) {
  return String(expense?.status ?? "").trim().toLowerCase();
}

function expenseAmount(expense) {
  return numeric(
    expense?.amount ??
    expense?.total_amount ??
    expense?.totalAmount ??
    0
  );
}

function getBudgetValue(budget, event) {
  return numeric(
    budget?.total_budget ??
    budget?.totalBudget ??
    budget?.allocated_budget ??
    budget?.allocatedBudget ??
    event?.budget ??
    0
  );
}

function getOwnerId(user) {
  return String(
    user?._id ??
    user?.id ??
    user?.user_id ??
    user?.user?._id ??
    user?.user?.id ??
    ""
  );
}

function getRole(user) {
  return String(
    user?.activeRole ??
    user?.role ??
    user?.user_role ??
    ""
  ).trim().toLowerCase();
}

function getEventVendorIds(event) {
  const values = [
    event?.vendor_id,
    event?.vendorId,
    event?.assigned_vendor_id,
    event?.assignedVendorId,
    ...(Array.isArray(event?.vendor_ids) ? event.vendor_ids : []),
    ...(Array.isArray(event?.vendorIds) ? event.vendorIds : []),
    ...(Array.isArray(event?.vendors) ? event.vendors : []),
    ...(Array.isArray(event?.assigned_vendors) ? event.assigned_vendors : []),
    ...(Array.isArray(event?.assignedVendors) ? event.assignedVendors : []),
  ];

  return values
    .map((value) => {
      if (typeof value === "object" && value !== null) {
        return String(value._id ?? value.id ?? value.vendor_id ?? "");
      }
      return String(value ?? "");
    })
    .filter(Boolean);
}

function vendorName(vendor) {
  return (
    vendor?.business_name ??
    vendor?.businessName ??
    vendor?.company_name ??
    vendor?.name ??
    vendor?.contact_person ??
    "Unnamed vendor"
  );
}

function vendorCategory(vendor) {
  return (
    vendor?.category ??
    vendor?.service_category ??
    vendor?.serviceCategory ??
    vendor?.services?.[0] ??
    "Other"
  );
}

function vendorStatus(vendor) {
  return String(vendor?.status ?? "Pending");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatCard({ icon: Icon, label, value, change, tone = "purple" }) {
  return (
    <article className={`reports-kpi-card tone-${tone}`}>
      <div className="reports-kpi-top">
        <span className="reports-kpi-icon">
          <Icon size={19} />
        </span>
        <span className="reports-kpi-decoration">
          <TrendingUp size={15} />
        </span>
      </div>

      <strong className="reports-kpi-value">{value}</strong>
      <span className="reports-kpi-label">{label}</span>

      {change && (
        <small className="reports-kpi-change">
          <TrendingUp size={11} />
          {change}
        </small>
      )}
    </article>
  );
}

function Panel({ title, icon: Icon, action, children, className = "" }) {
  return (
    <section className={`reports-card ${className}`}>
      <div className="reports-card-heading">
        <h3>
          {Icon && <Icon size={16} />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children = "No data available for the selected filters." }) {
  return <div className="reports-empty-state">{children}</div>;
}

export default function Reports({ user }) {
  const [activeTab, setActiveTab] = useState("event");
  const [period, setPeriod] = useState("6m");
  const [eventFilter, setEventFilter] = useState("all");
  const [venueFilter, setVenueFilter] = useState("all");
  const [reportType, setReportType] = useState("event");
  const [reportFormat, setReportFormat] = useState("pdf");

  const [events, setEvents] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [sponsorships, setSponsorships] = useState([]);
  const [attendeesByEvent, setAttendeesByEvent] = useState({});
  const [budgetsByEvent, setBudgetsByEvent] = useState({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [recentReports, setRecentReports] = useState([]);

  const loadReports = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    setError("");
    setWarnings([]);

    try {
      const [eventResult, sponsorshipResult, vendorResult] =
        await Promise.allSettled([
          getEvents(),
          getSponsorships(),
          apiRequest("/vendors/"),
        ]);

      if (eventResult.status === "rejected") {
        throw eventResult.reason;
      }

      const allEvents = asArray(eventResult.value, [
        "events",
        "items",
      ]);

      const role = getRole(user);
      const currentUserId = getOwnerId(user);

      let visibleEvents = allEvents;

      if (role === "organizer") {
        if (!currentUserId) {
          throw new Error(
            "Unable to identify the logged-in organizer. Please log in again."
          );
        }

        visibleEvents = allEvents.filter((event) => {
          const owner =
            event?.organizer_id ??
            event?.organizerId ??
            event?.created_by ??
            event?.createdBy ??
            event?.organizer;

          const ownerId =
            owner && typeof owner === "object"
              ? String(owner._id ?? owner.id ?? "")
              : String(owner ?? "");

          return ownerId === currentUserId;
        });
      }

      const nextWarnings = [];

      const sponsorshipList =
        sponsorshipResult.status === "fulfilled"
          ? asArray(sponsorshipResult.value, [
              "sponsorships",
              "items",
            ])
          : [];

      if (sponsorshipResult.status === "rejected") {
        nextWarnings.push("Sponsorship information could not be loaded.");
      }

      const vendorList =
        vendorResult.status === "fulfilled"
          ? asArray(vendorResult.value, ["vendors", "items"])
          : [];

      if (vendorResult.status === "rejected") {
        nextWarnings.push("Vendor information could not be loaded.");
      }

      const attendeeResults = await Promise.all(
        visibleEvents.map(async (event) => {
          const eventId = idOf(event);
          if (!eventId) return [eventId, []];

          try {
            const response = await apiRequest(
              `/attendees/event/${encodeURIComponent(eventId)}`
            );

            return [
              eventId,
              asArray(response, ["attendees", "registrations", "items"]),
            ];
          } catch (err) {
            nextWarnings.push(
              `Attendee data for ${eventName(event)} could not be loaded.`
            );
            return [eventId, []];
          }
        })
      );

      const budgetResults = await Promise.all(
        visibleEvents.map(async (event) => {
          const eventId = idOf(event);
          if (!eventId) {
            return [eventId, { budget: {}, expenses: [] }];
          }

          try {
            const response = await apiRequest(
              `/budgets/event/${encodeURIComponent(eventId)}`
            );

            return [
              eventId,
              {
                budget:
                  response?.budget ??
                  response?.data?.budget ??
                  {},
                expenses: asArray(response, ["expenses", "items"]),
              },
            ];
          } catch (err) {
            nextWarnings.push(
              `Budget data for ${eventName(event)} could not be loaded.`
            );
            return [eventId, { budget: {}, expenses: [] }];
          }
        })
      );

      setEvents(visibleEvents);
      setVendors(vendorList);
      setSponsorships(sponsorshipList);
      setAttendeesByEvent(Object.fromEntries(attendeeResults));
      setBudgetsByEvent(Object.fromEntries(budgetResults));
      setWarnings([...new Set(nextWarnings)]);
    } catch (err) {
      setError(
        err?.message || "Unable to load reports. Please try again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const venues = useMemo(() => {
    return [
      ...new Set(events.map(eventVenue).filter(
        (name) => name && name !== "Unspecified venue"
      )),
    ].sort((a, b) => a.localeCompare(b));
  }, [events]);

  const filteredEvents = useMemo(() => {
    const bounds = getPeriodBounds(period);

    return events.filter((event) => {
      const matchesPeriod = isInPeriod(event, bounds);
      const matchesEvent =
        eventFilter === "all" || idOf(event) === eventFilter;
      const matchesVenue =
        venueFilter === "all" || eventVenue(event) === venueFilter;

      return matchesPeriod && matchesEvent && matchesVenue;
    });
  }, [events, period, eventFilter, venueFilter]);

  const reportData = useMemo(() => {
    const visibleIds = new Set(filteredEvents.map(idOf));

    const registrations = filteredEvents.flatMap((event) =>
      (attendeesByEvent[idOf(event)] ?? []).map((attendee) => ({
        ...attendee,
        reportEvent: event,
      }))
    );

    const expenseRows = filteredEvents.flatMap((event) =>
      (budgetsByEvent[idOf(event)]?.expenses ?? []).map((expense) => ({
        ...expense,
        reportEvent: event,
      }))
    );

    const totalBudget = filteredEvents.reduce((sum, event) => {
      const budget = budgetsByEvent[idOf(event)]?.budget ?? {};
      return sum + getBudgetValue(budget, event);
    }, 0);

    const approvedExpenses = expenseRows.filter((expense) =>
      ["approved", "paid"].includes(expenseStatus(expense))
    );

    const pendingExpenses = expenseRows.filter(
      (expense) => expenseStatus(expense) === "pending"
    );

    const spent = approvedExpenses.reduce(
      (sum, expense) => sum + expenseAmount(expense),
      0
    );

    const pendingAmount = pendingExpenses.reduce(
      (sum, expense) => sum + expenseAmount(expense),
      0
    );

    const sponsorshipRevenue = sponsorships.reduce((sum, item) => {
      const linkedId = String(
        item?.event_id ??
        item?.eventId ??
        item?.event?.id ??
        item?.event?._id ??
        ""
      );

      if (linkedId && !visibleIds.has(linkedId)) return sum;
      if (!linkedId && period !== "all") return sum;

      if (["cancelled", "canceled", "rejected"].includes(expenseStatus(item))) {
        return sum;
      }

      return sum + numeric(
        item?.amount_received ??
        item?.amountReceived ??
        item?.received_amount ??
        item?.receivedAmount ??
        0
      );
    }, 0);

    const checkedInCount = registrations.filter(checkedIn).length;

    const statusMap = new Map();
    filteredEvents.forEach((event) => {
      const status = getEventStatus(event);
      statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
    });

    const statusData = [...statusMap].map(([name, value]) => ({
      name,
      value,
    }));

    const categoryMap = new Map();
    filteredEvents.forEach((event) => {
      const category = String(eventCategory(event));
      categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
    });

    const categoryData = [...categoryMap].map(([name, value]) => ({
      name,
      value,
    }));

    const monthMap = new Map();
    registrations.forEach((attendee) => {
      const value =
        attendee.registered_at ??
        attendee.registration_date ??
        attendee.created_at;

      const date = parseDate(value);
      if (!date) return;

      const key = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

      const label = new Intl.DateTimeFormat("en-IN", {
        month: "short",
      }).format(date);

      const current = monthMap.get(key) ?? {
        month: label,
        registrations: 0,
        sort: key,
      };

      current.registrations += 1;
      monthMap.set(key, current);
    });

    const monthlyRegistrations = [...monthMap.values()]
      .sort((a, b) => a.sort.localeCompare(b.sort))
      .map(({ sort, ...item }) => item);

    const monthlyEventMap = new Map();
    filteredEvents.forEach((event) => {
      const date = eventDate(event);
      if (!date) return;

      const key = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

      const label = new Intl.DateTimeFormat("en-IN", {
        month: "short",
      }).format(date);

      const current = monthlyEventMap.get(key) ?? {
        month: label,
        events: 0,
        sort: key,
      };

      current.events += 1;
      monthlyEventMap.set(key, current);
    });

    const eventTrend = [...monthlyEventMap.values()]
      .sort((a, b) => a.sort.localeCompare(b.sort))
      .map(({ sort, ...item }) => item);

    const expenseCategoryMap = new Map();
    expenseRows.forEach((expense) => {
      const category = String(expense.category ?? "Uncategorized");
      expenseCategoryMap.set(
        category,
        (expenseCategoryMap.get(category) ?? 0) + expenseAmount(expense)
      );
    });

    const expenseCategoryData = [...expenseCategoryMap].map(
      ([name, amount]) => ({ name, amount })
    );

    const vendorRows = vendors.map((vendor) => {
      const id = vendorIdOf(vendor);

      const assignedEvents = filteredEvents.filter((event) =>
        getEventVendorIds(event).includes(id)
      );

      return {
        ...vendor,
        reportId: id,
        reportName: vendorName(vendor),
        reportCategory: vendorCategory(vendor),
        assignedEvents,
        assignmentCount: assignedEvents.length,
      };
    });

    const activeVendors = vendorRows.filter((vendor) =>
      ["approved", "active"].includes(
        String(vendorStatus(vendor)).toLowerCase()
      )
    ).length;

    const assignedVendorCount = vendorRows.filter(
      (vendor) => vendor.assignmentCount > 0
    ).length;

    const vendorCategoryMap = new Map();
    vendorRows.forEach((vendor) => {
      const category = vendor.reportCategory;
      vendorCategoryMap.set(
        category,
        (vendorCategoryMap.get(category) ?? 0) + 1
      );
    });

    const vendorCategoryData = [...vendorCategoryMap].map(
      ([name, value]) => ({ name, value })
    );

    return {
      events: filteredEvents,
      registrations,
      expenseRows,
      totalBudget,
      spent,
      pendingAmount,
      remainingBudget: totalBudget - spent - pendingAmount,
      sponsorshipRevenue,
      checkedInCount,
      attendanceRate:
        registrations.length > 0
          ? (checkedInCount / registrations.length) * 100
          : 0,
      statusData,
      categoryData,
      monthlyRegistrations,
      eventTrend,
      expenseCategoryData,
      vendorRows,
      activeVendors,
      assignedVendorCount,
      vendorCategoryData,
      pendingCount: pendingExpenses.length,
      completedEvents: filteredEvents.filter(
        (event) => getEventStatus(event) === "Completed"
      ).length,
      upcomingEvents: filteredEvents.filter(
        (event) => getEventStatus(event) === "Upcoming"
      ).length,
    };
  }, [
    filteredEvents,
    attendeesByEvent,
    budgetsByEvent,
    sponsorships,
    vendors,
    period,
  ]);

  const selectedPeriodLabel =
    PERIOD_OPTIONS.find((item) => item.value === period)?.label ??
    "All Time";

  const selectedReportLabel =
    REPORT_OPTIONS.find((item) => item.value === reportType)?.label ??
    "Event Performance Report";

  const rememberReport = (type, format, filename) => {
    setRecentReports((current) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        type,
        format,
        filename,
        createdAt: new Date(),
      },
      ...current,
    ].slice(0, 5));
  };

  const getReportRows = (type) => {
    const eventRows = reportData.events.map((event) => {
      const id = idOf(event);
      const budget = budgetsByEvent[id]?.budget ?? {};
      const expenses = budgetsByEvent[id]?.expenses ?? [];

      const approved = expenses
        .filter((item) =>
          ["approved", "paid"].includes(expenseStatus(item))
        )
        .reduce((sum, item) => sum + expenseAmount(item), 0);

      const pending = expenses
        .filter((item) => expenseStatus(item) === "pending")
        .reduce((sum, item) => sum + expenseAmount(item), 0);

      return [
        eventName(event),
        formatDate(eventDate(event)),
        eventVenue(event),
        getEventStatus(event),
        (attendeesByEvent[id] ?? []).length,
        getBudgetValue(budget, event),
        approved,
        pending,
      ];
    });

    const attendeeRows = reportData.registrations.map((item) => [
      attendeeName(item),
      attendeeEmail(item),
      eventName(item.reportEvent),
      item.category ?? item.attendee_type ?? "General",
      formatDateTime(
        item.registered_at ??
        item.registration_date ??
        item.created_at
      ),
      ticketStatus(item),
      checkedIn(item) ? "Yes" : "No",
      formatDateTime(checkedInDate(item)),
    ]);

    const budgetRows = reportData.events.map((event) => {
      const id = idOf(event);
      const budget = budgetsByEvent[id]?.budget ?? {};
      const expenses = budgetsByEvent[id]?.expenses ?? [];

      const approved = expenses
        .filter((item) =>
          ["approved", "paid"].includes(expenseStatus(item))
        )
        .reduce((sum, item) => sum + expenseAmount(item), 0);

      const pending = expenses
        .filter((item) => expenseStatus(item) === "pending")
        .reduce((sum, item) => sum + expenseAmount(item), 0);

      const allocated = getBudgetValue(budget, event);

      return [
        eventName(event),
        allocated,
        approved,
        pending,
        allocated - approved - pending,
      ];
    });

    const vendorRows = reportData.vendorRows.map((vendor) => [
      vendor.reportName,
      vendor.reportCategory,
      vendor.contact_person ?? vendor.contactPerson ?? "—",
      vendor.email ?? "—",
      vendor.city ?? "—",
      vendorStatus(vendor),
      vendor.assignmentCount,
      vendor.assignedEvents.map(eventName).join("; "),
    ]);

    if (type === "event") {
      return {
        headers: [
          "Event",
          "Event Date",
          "Venue",
          "Status",
          "Registrations",
          "Budget (INR)",
          "Approved/Paid (INR)",
          "Pending (INR)",
        ],
        rows: eventRows,
      };
    }

    if (type === "attendee") {
      return {
        headers: [
          "Attendee",
          "Email",
          "Event",
          "Category",
          "Registered At",
          "Ticket Status",
          "Checked In",
          "Checked In At",
        ],
        rows: attendeeRows,
      };
    }

    if (type === "budget") {
      return {
        headers: [
          "Event",
          "Allocated Budget (INR)",
          "Approved/Paid (INR)",
          "Pending (INR)",
          "Remaining (INR)",
        ],
        rows: budgetRows,
      };
    }

    if (type === "vendor") {
      return {
        headers: [
          "Vendor",
          "Category",
          "Contact Person",
          "Email",
          "City",
          "Status",
          "Assigned Events",
          "Event Names",
        ],
        rows: vendorRows,
      };
    }

    return {
      headers: [],
      rows: [],
    };
  };

  const buildPdf = (type) => {
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });

    const width = doc.internal.pageSize.getWidth();
    const margin = 12;

    const safe = (value) =>
      String(value ?? "—")
        .replace(/₹/g, "INR ")
        .replace(/[–—]/g, "-")
        .replace(/[^\x20-\x7E]/g, "");

    const title =
      REPORT_OPTIONS.find((item) => item.value === type)?.label ??
      "EventSphere Report";

    const generatedAt = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());

    const drawHeader = () => {
      doc.setFillColor(35, 27, 89);
      doc.rect(0, 0, width, 27, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(safe(title), margin, 12);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Reporting period: ${safe(selectedPeriodLabel)}`, margin, 19);
      doc.text(`Generated: ${generatedAt}`, width - margin, 19, {
        align: "right",
      });
    };

    drawHeader();

    const summary = [
      ["Events", reportData.events.length],
      ["Registrations", reportData.registrations.length],
      ["Checked in", reportData.checkedInCount],
      ["Attendance rate", `${reportData.attendanceRate.toFixed(1)}%`],
      ["Total budget", formatMoney(reportData.totalBudget)],
      ["Approved / paid", formatMoney(reportData.spent)],
      ["Pending expenses", formatMoney(reportData.pendingAmount)],
      ["Sponsorship received", formatMoney(reportData.sponsorshipRevenue)],
    ];

    const cardGap = 4;
    const cardWidth = (width - margin * 2 - cardGap * 3) / 4;

    summary.forEach(([label, value], index) => {
      const row = Math.floor(index / 4);
      const column = index % 4;
      const x = margin + column * (cardWidth + cardGap);
      const y = 33 + row * 21;

      doc.setFillColor(246, 245, 253);
      doc.setDrawColor(226, 222, 244);
      doc.roundedRect(x, y, cardWidth, 17, 2, 2, "FD");

      doc.setTextColor(105, 98, 135);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(safe(label), x + 4, y + 6);

      doc.setTextColor(35, 27, 89);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(safe(value), x + 4, y + 12.5, {
        maxWidth: cardWidth - 8,
      });
    });

    const report = getReportRows(type);
    const tableTitle = title;
    const startY = 80;

    doc.setTextColor(35, 27, 89);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(safe(tableTitle), margin, startY - 4);

    autoTable(doc, {
      startY,
      head: [report.headers],
      body: report.rows.length
        ? report.rows.map((row) => row.map(safe))
        : [["No records found for the selected filters."]],
      margin: { left: margin, right: margin, top: 32, bottom: 14 },
      styles: {
        font: "helvetica",
        fontSize: 7.5,
        cellPadding: 2.5,
        textColor: [65, 65, 82],
        lineColor: [229, 227, 239],
        lineWidth: 0.15,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [103, 70, 221],
        textColor: 255,
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: [248, 247, 252],
      },
      didDrawPage: () => {
        drawHeader();
      },
    });

    const pageCount = doc.internal.getNumberOfPages();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(225, 223, 235);
      doc.line(margin, pageHeight - 9, width - margin, pageHeight - 9);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 116, 137);
      doc.text("EventSphere | Reports", margin, pageHeight - 5);
      doc.text(`Page ${page} of ${pageCount}`, width - margin, pageHeight - 5, {
        align: "right",
      });
    }

    return doc;
  };

  const exportPdf = (type = reportType) => {
    try {
      const doc = buildPdf(type);
      const filename = `eventsphere-${type}-report-${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`;

      doc.save(filename);
      rememberReport(type, "PDF", filename);
    } catch (err) {
      console.error("PDF export failed:", err);
      window.alert("Unable to generate the PDF report. Please try again.");
    }
  };

  const exportCsv = (type = reportType) => {
    try {
      const report = getReportRows(type);
      const rows = [
        ["EventSphere Report", REPORT_OPTIONS.find(
          (item) => item.value === type
        )?.label ?? "Report"],
        ["Reporting period", selectedPeriodLabel],
        ["Generated", new Date().toLocaleString("en-IN")],
        [],
        report.headers,
        ...report.rows,
      ];

      const filename = `eventsphere-${type}-report-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      downloadCsv(filename, rows);
      rememberReport(type, "CSV", filename);
    } catch (err) {
      console.error("CSV export failed:", err);
      window.alert("Unable to generate the CSV report. Please try again.");
    }
  };

  const generateSelectedReport = () => {
    if (reportFormat === "pdf") exportPdf(reportType);
    else exportCsv(reportType);
  };

  const exportAllData = () => {
    const types = ["event", "attendee", "budget", "vendor"];
    const rows = [
      ["EventSphere Complete Report"],
      ["Reporting period", selectedPeriodLabel],
      ["Generated", new Date().toLocaleString("en-IN")],
      [],
    ];

    types.forEach((type) => {
      const report = getReportRows(type);
      rows.push([REPORT_OPTIONS.find((item) => item.value === type)?.label]);
      rows.push(report.headers);
      rows.push(...report.rows);
      rows.push([]);
    });

    const filename = `eventsphere-complete-report-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    downloadCsv(filename, rows);
    rememberReport("all", "CSV", filename);
  };

  const downloadRecentReport = (report) => {
    if (report.format === "PDF") exportPdf(report.type);
    else exportCsv(report.type);
  };

  const resetFilters = () => {
    setPeriod("6m");
    setEventFilter("all");
    setVenueFilter("all");
  };

  if (loading) {
    return (
      <div className="reports-page">
        <div className="reports-loading">
          <RefreshCw size={20} className="reports-spin" />
          Loading EventSphere reports...
        </div>
      </div>
    );
  }

  return (
    <div className="reports-page">
      {/* Page heading */}
      <header className="reports-header">
        <div className="reports-heading">
          <div className="reports-heading-icon">
            <BarChart3 size={23} />
          </div>

          <div>
            <h1>Reports</h1>
            <p>Generate and download detailed reports about your events</p>
          </div>
        </div>

        <div className="reports-header-actions">
          <button
            type="button"
            className="reports-outline-button"
            onClick={exportAllData}
          >
            <Download size={15} />
            Export All Data
            <ChevronDown size={14} />
          </button>

          <button
            type="button"
            className="reports-primary-button"
            onClick={generateSelectedReport}
          >
            <FileText size={15} />
            Generate Report
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="reports-tabs" aria-label="Report categories">
        {TABS.map((tab) => {
          const Icon = tab.icon;

          return (
            <button
              type="button"
              key={tab.id}
              className={`reports-tab ${
                activeTab === tab.id ? "active" : ""
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                setReportType(tab.id);
              }}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Filters */}
      <section className="reports-filter-bar">
        <label className="reports-filter-control">
          <CalendarDays size={15} />
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            aria-label="Filter by date"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>

        <label className="reports-filter-control">
          <Filter size={15} />
          <select
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
            aria-label="Filter by event"
          >
            <option value="all">All Events</option>
            {events.map((event) => (
              <option key={idOf(event)} value={idOf(event)}>
                {eventName(event)}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>

        <label className="reports-filter-control">
          <MapPin size={15} />
          <select
            value={venueFilter}
            onChange={(event) => setVenueFilter(event.target.value)}
            aria-label="Filter by venue"
          >
            <option value="all">All Venues</option>
            {venues.map((venue) => (
              <option key={venue} value={venue}>
                {venue}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>

        <button
          type="button"
          className="reports-apply-button"
          onClick={() => loadReports(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <RefreshCw size={14} className="reports-spin" />
          ) : (
            <Filter size={14} />
          )}
          Apply Filters
        </button>

        <button
          type="button"
          className="reports-reset-button"
          onClick={resetFilters}
          title="Reset filters"
        >
          Reset
        </button>
      </section>

      {error && (
        <div className="reports-alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button type="button" onClick={() => loadReports(true)}>
            Retry
          </button>
        </div>
      )}

      {!error && warnings.length > 0 && (
        <div className="reports-warning">
          <AlertCircle size={16} />
          Some report data could not be loaded. Certain figures may be incomplete.
          <span>{warnings.length} request(s) failed.</span>
        </div>
      )}

      {/* Summary cards */}
      <section className="reports-kpi-grid">
        {activeTab === "event" && (
          <>
            <StatCard
              icon={CalendarDays}
              label="Total Events"
              value={reportData.events.length}
              change={`${reportData.upcomingEvents} upcoming`}
              tone="purple"
            />
            <StatCard
              icon={Users}
              label="Total Attendees"
              value={reportData.registrations.length.toLocaleString("en-IN")}
              change={`${reportData.attendanceRate.toFixed(1)}% attendance`}
              tone="blue"
            />
            <StatCard
              icon={CheckCircle2}
              label="Completed Events"
              value={reportData.completedEvents}
              change="Based on event dates"
              tone="green"
            />
            <StatCard
              icon={Wallet}
              label="Total Budget"
              value={formatMoney(reportData.totalBudget)}
              change="Selected events"
              tone="orange"
            />
          </>
        )}

        {activeTab === "attendee" && (
          <>
            <StatCard
              icon={Users}
              label="Total Registrations"
              value={reportData.registrations.length}
              change="Selected events"
              tone="purple"
            />
            <StatCard
              icon={CheckCircle2}
              label="Checked In"
              value={reportData.checkedInCount}
              change="Attendees checked in"
              tone="green"
            />
            <StatCard
              icon={Activity}
              label="Attendance Rate"
              value={`${reportData.attendanceRate.toFixed(1)}%`}
              change="Check-ins / registrations"
              tone="blue"
            />
            <StatCard
              icon={Clock3}
              label="Not Checked In"
              value={Math.max(
                0,
                reportData.registrations.length - reportData.checkedInCount
              )}
              change="Remaining attendees"
              tone="orange"
            />
          </>
        )}

        {activeTab === "budget" && (
          <>
            <StatCard
              icon={Wallet}
              label="Total Budget"
              value={formatMoney(reportData.totalBudget)}
              change="Selected events"
              tone="purple"
            />
            <StatCard
              icon={IndianRupee}
              label="Approved / Paid"
              value={formatMoney(reportData.spent)}
              change="Recorded expenses"
              tone="blue"
            />
            <StatCard
              icon={Clock3}
              label="Pending Expenses"
              value={formatMoney(reportData.pendingAmount)}
              change={`${reportData.pendingCount} pending item(s)`}
              tone="orange"
            />
            <StatCard
              icon={TrendingUp}
              label="Remaining Budget"
              value={formatMoney(reportData.remainingBudget)}
              change="After approved and pending"
              tone="green"
            />
          </>
        )}

        {activeTab === "vendor" && (
          <>
            <StatCard
              icon={Building2}
              label="Total Vendors"
              value={reportData.vendorRows.length}
              change="Vendor directory"
              tone="purple"
            />
            <StatCard
              icon={CheckCircle2}
              label="Approved / Active"
              value={reportData.activeVendors}
              change="Based on vendor status"
              tone="green"
            />
            <StatCard
              icon={BriefcaseBusiness}
              label="Assigned Vendors"
              value={reportData.assignedVendorCount}
              change="Linked to selected events"
              tone="blue"
            />
            <StatCard
              icon={CalendarDays}
              label="Vendor Assignments"
              value={reportData.vendorRows.reduce(
                (sum, vendor) => sum + vendor.assignmentCount,
                0
              )}
              change="Event assignments"
              tone="orange"
            />
          </>
        )}
      </section>

      {/* Event performance */}
      {activeTab === "event" && (
        <>
          <section className="reports-visual-grid">
            <Panel
              title="Event Performance Overview"
              icon={BarChart3}
              className="reports-performance-panel"
            >
              {reportData.eventTrend.length > 0 ? (
                <div className="reports-main-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={reportData.eventTrend}
                      margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="#eceaf5"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: "#77758d", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="left"
                        allowDecimals={false}
                        tick={{ fill: "#77758d", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        allowDecimals={false}
                        tick={{ fill: "#77758d", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip />
                      <Legend />
                      <Bar
                        yAxisId="left"
                        dataKey="events"
                        name="Events"
                        fill="#7047eb"
                        radius={[5, 5, 0, 0]}
                        barSize={22}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState>No event dates available for this period.</EmptyState>
              )}
            </Panel>

            <Panel
              title="Event Category Distribution"
              icon={PieChartIcon}
              className="reports-category-panel"
            >
              {reportData.categoryData.length > 0 ? (
                <div className="reports-category-chart">
                  <div className="reports-donut">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={reportData.categoryData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={54}
                          outerRadius={82}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {reportData.categoryData.map((item, index) => (
                            <Cell
                              key={item.name}
                              fill={COLORS[index % COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="reports-donut-center">
                      <strong>
                        {reportData.events.length
                          ? Math.round(
                              (Math.max(
                                ...reportData.categoryData.map(
                                  (item) => item.value
                                )
                              ) /
                                reportData.events.length) *
                                100
                            )
                          : 0}%
                      </strong>
                      <span>Top Category</span>
                    </div>
                  </div>

                  <div className="reports-chart-legend">
                    {reportData.categoryData.map((item, index) => (
                      <div key={item.name}>
                        <span
                          className="reports-legend-dot"
                          style={{
                            background: COLORS[index % COLORS.length],
                          }}
                        />
                        <span className="reports-legend-name">
                          {item.name}
                        </span>
                        <strong>
                          {reportData.events.length
                            ? Math.round(
                                (item.value / reportData.events.length) * 100
                              )
                            : 0}%
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState>No event categories found.</EmptyState>
              )}
            </Panel>
          </section>

          <section className="reports-secondary-grid">
            <Panel title="Attendee Registration Trend" icon={Users}>
              {reportData.monthlyRegistrations.length > 0 ? (
                <div className="reports-small-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.monthlyRegistrations}>
                      <CartesianGrid
                        stroke="#eceaf5"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar
                        dataKey="registrations"
                        name="Registrations"
                        fill="#3c82f6"
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState>No registration trend data found.</EmptyState>
              )}
            </Panel>

            <Panel title="Recent Event Activity" icon={Activity}>
              <div className="reports-activity-list">
                {reportData.events.slice(0, 5).map((event) => (
                  <div className="reports-activity-item" key={idOf(event)}>
                    <span className="reports-activity-icon">
                      <CalendarDays size={15} />
                    </span>
                    <div>
                      <strong>{eventName(event)}</strong>
                      <small>
                        {formatDate(eventDate(event))} · {eventVenue(event)}
                      </small>
                    </div>
                    <span
                      className={`reports-status status-${getEventStatus(
                        event
                      ).toLowerCase()}`}
                    >
                      {getEventStatus(event)}
                    </span>
                  </div>
                ))}
                {reportData.events.length === 0 && (
                  <EmptyState>No events found.</EmptyState>
                )}
              </div>
            </Panel>
          </section>
        </>
      )}

      {/* Attendee reports */}
      {activeTab === "attendee" && (
        <>
          <section className="reports-secondary-grid">
            <Panel title="Registration Trend" icon={TrendingUp}>
              {reportData.monthlyRegistrations.length > 0 ? (
                <div className="reports-small-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.monthlyRegistrations}>
                      <CartesianGrid
                        stroke="#eceaf5"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar
                        dataKey="registrations"
                        name="Registrations"
                        fill="#7047eb"
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState>No registration data available.</EmptyState>
              )}
            </Panel>

            <Panel title="Ticket Check-in Summary" icon={CheckCircle2}>
              <div className="reports-checkin-summary">
                <div className="reports-checkin-ring">
                  <strong>{reportData.attendanceRate.toFixed(0)}%</strong>
                  <span>Checked in</span>
                </div>
                <div className="reports-checkin-legend">
                  <div>
                    <span className="reports-legend-dot green" />
                    Checked in
                    <strong>{reportData.checkedInCount}</strong>
                  </div>
                  <div>
                    <span className="reports-legend-dot orange" />
                    Not checked in
                    <strong>
                      {reportData.registrations.length -
                        reportData.checkedInCount}
                    </strong>
                  </div>
                  <div>
                    <span className="reports-legend-dot purple" />
                    Total registrations
                    <strong>{reportData.registrations.length}</strong>
                  </div>
                </div>
              </div>
            </Panel>
          </section>

          <Panel
            title="Attendee Registration Details"
            icon={Users}
            action={
              <button
                type="button"
                className="reports-text-button"
                onClick={() => exportCsv("attendee")}
              >
                <Download size={14} /> Export CSV
              </button>
            }
          >
            {reportData.registrations.length > 0 ? (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Attendee</th>
                      <th>Email</th>
                      <th>Event</th>
                      <th>Category</th>
                      <th>Registered</th>
                      <th>Ticket Status</th>
                      <th>Check-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.registrations.map((item, index) => (
                      <tr
                        key={
                          item.registration_id ??
                          item.attendee_id ??
                          item._id ??
                          `${attendeeEmail(item)}-${index}`
                        }
                      >
                        <td><strong>{attendeeName(item)}</strong></td>
                        <td>{attendeeEmail(item)}</td>
                        <td>{eventName(item.reportEvent)}</td>
                        <td>{item.category ?? item.attendee_type ?? "General"}</td>
                        <td>
                          {formatDateTime(
                            item.registered_at ??
                            item.registration_date ??
                            item.created_at
                          )}
                        </td>
                        <td>
                          <span className="reports-ticket-badge">
                            {ticketStatus(item)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`reports-checkin-badge ${
                              checkedIn(item) ? "checked" : "not-checked"
                            }`}
                          >
                            {checkedIn(item) ? "Checked In" : "Not Checked In"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No attendee registrations match these filters.</EmptyState>
            )}
          </Panel>
        </>
      )}

      {/* Budget reports */}
      {activeTab === "budget" && (
        <>
          <section className="reports-secondary-grid">
            <Panel title="Expense Overview" icon={Wallet}>
              <div className="reports-budget-overview">
                <div>
                  <span>Approved / Paid</span>
                  <strong>{formatMoney(reportData.spent)}</strong>
                  <div className="reports-progress-track">
                    <span
                      style={{
                        width: `${
                          reportData.totalBudget > 0
                            ? Math.min(
                                100,
                                (reportData.spent / reportData.totalBudget) * 100
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <span>Pending Expenses</span>
                  <strong>{formatMoney(reportData.pendingAmount)}</strong>
                  <div className="reports-progress-track orange">
                    <span
                      style={{
                        width: `${
                          reportData.totalBudget > 0
                            ? Math.min(
                                100,
                                (reportData.pendingAmount /
                                  reportData.totalBudget) *
                                  100
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <span>Remaining Budget</span>
                  <strong>{formatMoney(reportData.remainingBudget)}</strong>
                  <div className="reports-progress-track green">
                    <span
                      style={{
                        width: `${
                          reportData.totalBudget > 0
                            ? Math.max(
                                0,
                                Math.min(
                                  100,
                                  (reportData.remainingBudget /
                                    reportData.totalBudget) *
                                    100
                                )
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Expenses by Category" icon={PieChartIcon}>
              {reportData.expenseCategoryData.length > 0 ? (
                <div className="reports-small-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.expenseCategoryData}>
                      <CartesianGrid
                        stroke="#eceaf5"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(value) =>
                          value >= 1000
                            ? `${Math.round(value / 1000)}k`
                            : value
                        }
                      />
                      <Tooltip formatter={(value) => formatMoney(value)} />
                      <Bar
                        dataKey="amount"
                        name="Expense Amount"
                        fill="#f59e0b"
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState>No expense records available.</EmptyState>
              )}
            </Panel>
          </section>

          <Panel
            title="Event-wise Budget Report"
            icon={IndianRupee}
            action={
              <button
                type="button"
                className="reports-text-button"
                onClick={() => exportCsv("budget")}
              >
                <Download size={14} /> Export CSV
              </button>
            }
          >
            {reportData.events.length > 0 ? (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Allocated Budget</th>
                      <th>Approved / Paid</th>
                      <th>Pending</th>
                      <th>Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.events.map((event) => {
                      const id = idOf(event);
                      const budget = budgetsByEvent[id]?.budget ?? {};
                      const expenses = budgetsByEvent[id]?.expenses ?? [];
                      const allocated = getBudgetValue(budget, event);

                      const approved = expenses
                        .filter((item) =>
                          ["approved", "paid"].includes(expenseStatus(item))
                        )
                        .reduce((sum, item) => sum + expenseAmount(item), 0);

                      const pending = expenses
                        .filter((item) => expenseStatus(item) === "pending")
                        .reduce((sum, item) => sum + expenseAmount(item), 0);

                      return (
                        <tr key={id}>
                          <td><strong>{eventName(event)}</strong></td>
                          <td>{formatMoney(allocated)}</td>
                          <td>{formatMoney(approved)}</td>
                          <td>{formatMoney(pending)}</td>
                          <td className="reports-remaining-cell">
                            {formatMoney(allocated - approved - pending)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No budget records match these filters.</EmptyState>
            )}
          </Panel>
        </>
      )}

      {/* Vendor performance */}
      {activeTab === "vendor" && (
        <>
          <section className="reports-secondary-grid">
            <Panel title="Vendor Categories" icon={PieChartIcon}>
              {reportData.vendorCategoryData.length > 0 ? (
                <div className="reports-category-chart reports-vendor-chart">
                  <div className="reports-donut">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={reportData.vendorCategoryData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={75}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {reportData.vendorCategoryData.map((item, index) => (
                            <Cell
                              key={item.name}
                              fill={COLORS[index % COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="reports-donut-center">
                      <strong>{reportData.vendorRows.length}</strong>
                      <span>Vendors</span>
                    </div>
                  </div>

                  <div className="reports-chart-legend">
                    {reportData.vendorCategoryData.map((item, index) => (
                      <div key={item.name}>
                        <span
                          className="reports-legend-dot"
                          style={{
                            background: COLORS[index % COLORS.length],
                          }}
                        />
                        <span className="reports-legend-name">{item.name}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState>No vendor categories available.</EmptyState>
              )}
            </Panel>

            <Panel title="Vendor Assignment Summary" icon={BriefcaseBusiness}>
              <div className="reports-vendor-summary">
                <div>
                  <span className="reports-vendor-summary-icon purple">
                    <Building2 size={18} />
                  </span>
                  <div>
                    <strong>{reportData.vendorRows.length}</strong>
                    <small>Total vendors</small>
                  </div>
                </div>
                <div>
                  <span className="reports-vendor-summary-icon green">
                    <CheckCircle2 size={18} />
                  </span>
                  <div>
                    <strong>{reportData.activeVendors}</strong>
                    <small>Approved / active vendors</small>
                  </div>
                </div>
                <div>
                  <span className="reports-vendor-summary-icon blue">
                    <ClipboardList size={18} />
                  </span>
                  <div>
                    <strong>{reportData.assignedVendorCount}</strong>
                    <small>Vendors assigned to events</small>
                  </div>
                </div>
              </div>
            </Panel>
          </section>

          <Panel
            title="Vendor Performance Details"
            icon={BriefcaseBusiness}
            action={
              <button
                type="button"
                className="reports-text-button"
                onClick={() => exportCsv("vendor")}
              >
                <Download size={14} /> Export CSV
              </button>
            }
          >
            {reportData.vendorRows.length > 0 ? (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Service Category</th>
                      <th>Contact Person</th>
                      <th>Email</th>
                      <th>City</th>
                      <th>Status</th>
                      <th>Assigned Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.vendorRows.map((vendor) => (
                      <tr key={vendor.reportId || vendor.reportName}>
                        <td><strong>{vendor.reportName}</strong></td>
                        <td>{vendor.reportCategory}</td>
                        <td>
                          {vendor.contact_person ??
                            vendor.contactPerson ??
                            "—"}
                        </td>
                        <td>{vendor.email ?? "—"}</td>
                        <td>{vendor.city ?? "—"}</td>
                        <td>
                          <span
                            className={`reports-vendor-status status-${vendorStatus(
                              vendor
                            ).toLowerCase()}`}
                          >
                            {vendorStatus(vendor)}
                          </span>
                        </td>
                        <td>{vendor.assignmentCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No vendors found in the vendor directory.</EmptyState>
            )}
          </Panel>
        </>
      )}

      {/* Download reports and recent reports */}
      <section className="reports-bottom-grid">
        <Panel title="Download Reports" icon={FileText}>
          <p className="reports-bottom-description">
            Choose a report type and generate your report.
          </p>

          <div className="reports-download-controls">
            <label>
              <span>Report</span>
              <select
                value={reportType}
                onChange={(event) => setReportType(event.target.value)}
              >
                {REPORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Format</span>
              <select
                value={reportFormat}
                onChange={(event) => setReportFormat(event.target.value)}
              >
                <option value="pdf">PDF Format</option>
                <option value="csv">CSV Format</option>
              </select>
            </label>

            <button
              type="button"
              className="reports-primary-button reports-download-button"
              onClick={generateSelectedReport}
            >
              <Download size={14} />
              Download Report
            </button>
          </div>
        </Panel>

        <Panel
          title="Recent Reports"
          icon={ListFilter}
          action={
            <span className="reports-recent-count">
              {recentReports.length} recent
            </span>
          }
        >
          {recentReports.length > 0 ? (
            <div className="reports-recent-list">
              {recentReports.map((report) => (
                <div className="reports-recent-row" key={report.id}>
                  <span className="reports-recent-file">
                    {report.format === "PDF" ? (
                      <FileText size={15} />
                    ) : (
                      <FileSpreadsheet size={15} />
                    )}
                  </span>
                  <div className="reports-recent-info">
                    <strong>{report.filename}</strong>
                    <small>
                      {report.format} · {formatDateTime(report.createdAt)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="reports-recent-download"
                    onClick={() => downloadRecentReport(report)}
                    title="Generate this report again"
                  >
                    <Download size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="reports-recent-empty">
              <Clock3 size={19} />
              <span>Your generated reports will appear here.</span>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}
