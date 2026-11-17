# scheduler/reminder_scheduler.py

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from services.notification_service import process_event_reminders


logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")

REMINDER_JOB_ID = "eventsphere_event_reminders"

REMINDER_INTERVAL_MINUTES = 30


# ---------------------------------------------------------
# SCHEDULER INSTANCE
# ---------------------------------------------------------

scheduler = AsyncIOScheduler(
    timezone=IST,
)


# ---------------------------------------------------------
# REMINDER JOB
# ---------------------------------------------------------

def run_reminder_job(db):
    """
    Execute the event reminder service.

    This function is called:
        1. Immediately when the scheduler starts.
        2. Every 30 minutes afterwards.

    Errors are logged instead of crashing the scheduler.
    """

    try:
        logger.info(
            "Starting EventSphere reminder job at %s",
            datetime.now(IST).isoformat(),
        )

        result = process_event_reminders(db)

        logger.info(
            "EventSphere reminder job completed successfully: %s",
            result,
        )

        return result

    except Exception:
        logger.exception(
            "EventSphere reminder job failed."
        )

        return {
            "processed": 0,
            "created": 0,
            "skipped": 0,
            "success": False,
        }


# ---------------------------------------------------------
# START SCHEDULER
# ---------------------------------------------------------

def start_reminder_scheduler(db):
    """
    Start the automatic event reminder scheduler.

    Execution:
        - First execution: Immediately at startup.
        - Subsequent executions: Every 30 minutes.

    The scheduler uses the MongoDB connection supplied
    by the FastAPI application.
    """

    if db is None:
        raise ValueError(
            "MongoDB database instance is required "
            "to start the reminder scheduler."
        )

    # Prevent multiple scheduler instances/jobs.
    if scheduler.running:
        existing_job = scheduler.get_job(
            REMINDER_JOB_ID
        )

        if existing_job:
            logger.info(
                "EventSphere reminder scheduler is already running."
            )
            return

    # Remove an old job if it exists.
    existing_job = scheduler.get_job(
        REMINDER_JOB_ID
    )

    if existing_job:
        scheduler.remove_job(
            REMINDER_JOB_ID
        )

    # Register the reminder job.
    scheduler.add_job(
        run_reminder_job,
        trigger=IntervalTrigger(
            minutes=REMINDER_INTERVAL_MINUTES,
            timezone=IST,
        ),
        args=[db],
        id=REMINDER_JOB_ID,
        name="EventSphere Event Reminders",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=900,
        next_run_time=datetime.now(IST),
    )

    # Start scheduler only after registering the job.
    if not scheduler.running:
        scheduler.start()

    logger.info(
        "EventSphere reminder scheduler started. "
        "First execution: immediate. "
        "Next executions: every %s minutes. "
        "Timezone: Asia/Kolkata.",
        REMINDER_INTERVAL_MINUTES,
    )


# ---------------------------------------------------------
# STOP SCHEDULER
# ---------------------------------------------------------

def stop_reminder_scheduler():
    """
    Stop the scheduler during FastAPI shutdown.
    """

    if not scheduler.running:
        logger.info(
            "EventSphere reminder scheduler is not running."
        )
        return

    try:
        scheduler.shutdown(
            wait=False,
        )

        logger.info(
            "EventSphere reminder scheduler stopped successfully."
        )

    except Exception:
        logger.exception(
            "Failed to stop EventSphere reminder scheduler."
        )


# ---------------------------------------------------------
# SCHEDULER STATUS
# ---------------------------------------------------------

def is_reminder_scheduler_running() -> bool:
    """Return whether the reminder scheduler is active."""

    return scheduler.running