
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from services.notification_service import process_event_reminders


logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")

scheduler = AsyncIOScheduler(
    timezone=IST,
)


# ---------------------------------------------------------
# START SCHEDULER
# ---------------------------------------------------------

def start_reminder_scheduler(db):
    """
    Start automatic event reminder checks.

    Runs immediately and then every 30 minutes.
    """

    if scheduler.running:
        logger.info("Event reminder scheduler is already running.")
        return

    scheduler.add_job(
        process_event_reminders,
        trigger=IntervalTrigger(
            minutes=30,
            timezone=IST,
        ),
        args=[db],
        id="eventsphere_event_reminders",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=900,
        next_run_time=datetime.now(IST),
    )

    scheduler.start()

    logger.info(
        "Event reminder scheduler started successfully."
    )


# ---------------------------------------------------------
# STOP SCHEDULER
# ---------------------------------------------------------

def stop_reminder_scheduler():
    """
    Stop the scheduler during application shutdown.
    """

    if scheduler.running:
        scheduler.shutdown(wait=False)

        logger.info(
            "Event reminder scheduler stopped."
        )
def run_reminder_job(db):
    try:
        result = process_event_reminders(db)

        logger.info(
            "Scheduled reminder job completed: %s",
            result,
        )

    except Exception:
        logger.exception(
            "Scheduled event reminder job failed."
        )