/* Exercise the real FPC callbacks with recorded identity relationships.
 * Only the device action/report and state-machine boundaries are replaced;
 * FpPrint creation, identity serialization and comparison use libfprint.
 */
#include "drivers_api.h"
#include FPC_DRIVER_SOURCE

static FpiDeviceAction action;
static GPtrArray *candidates;
static FpPrint *enrollment;
static FpPrint *reported;
static FpiMatchResult verify_result;
static gboolean completed;
static gint jumped_to;

FpiDeviceAction __wrap_fpi_device_get_current_action (FpDevice *device)
{ return action; }
void __wrap_fpi_device_get_identify_data (FpDevice *device, GPtrArray **prints)
{ *prints = candidates; }
void __wrap_fpi_device_get_verify_data (FpDevice *device, FpPrint **print)
{ *print = g_ptr_array_index (candidates, 0); }
void __wrap_fpi_device_get_enroll_data (FpDevice *device, FpPrint **print)
{ *print = enrollment; }
void __wrap_fpi_device_identify_report (FpDevice *device, FpPrint *match, FpPrint *print, GError *error)
{ g_assert_no_error (error); reported = match; }
void __wrap_fpi_device_verify_report (FpDevice *device, FpiMatchResult result, FpPrint *print, GError *error)
{ g_assert_no_error (error); verify_result = result; }
void __wrap_fpi_ssm_mark_completed (FpiSsm *ssm)
{ completed = TRUE; }
void __wrap_fpi_ssm_next_state (FpiSsm *ssm) {}
void __wrap_fpi_ssm_jump_to_state (FpiSsm *ssm, int state)
{ jumped_to = state; }
void __wrap_fpi_ssm_mark_failed (FpiSsm *ssm, GError *error)
{ g_error ("Unexpected driver failure: %s", error->message); }

static FpPrint *
make_print (FpiDeviceFpcMoc *self, guint8 identity)
{
  fpc_fid_data_t data = {0};
  data.subfactor = FPC_SUBTYPE_RESERVED;
  data.identity_type = 2;
  data.identity_size = 16;
  memset (data.identity, identity, 16);
  return fpc_print_from_data (self, &data);
}

static void
check_match (FpiDeviceFpcMoc *self, FpiDeviceAction requested_action,
             guint8 identity, FpPrint *expected)
{
  FPC_IDENTIFY response = {0};
  response.subfactor = FPC_SUBTYPE_RESERVED;
  response.identity_type = 2;
  response.identity_size = 16;
  memset (response.data, identity, 16);
  action = requested_action;
  reported = NULL;
  completed = FALSE;
  verify_result = FPI_MATCH_ERROR;
  fpc_verify_cb (self, &response, NULL);
  g_assert_true (completed);
  if (action == FPI_DEVICE_ACTION_IDENTIFY)
    g_assert_true (reported == expected);
  else
    g_assert_cmpint (verify_result, ==, expected ? FPI_MATCH_SUCCESS : FPI_MATCH_FAIL);
}

static void
test_single_candidate (void)
{
  g_autoptr(FpiDeviceFpcMoc) self = g_object_new (fpi_device_fpcmoc_get_type (), NULL);
  self->is_9924 = TRUE;
  candidates = g_ptr_array_new_with_free_func (g_object_unref);
  FpPrint *first = make_print (self, 0x11);
  g_ptr_array_add (candidates, first);
  /* A hidden on-chip second finger must not be reported as the first. */
  check_match (self, FPI_DEVICE_ACTION_IDENTIFY, 0x22, NULL);
  check_match (self, FPI_DEVICE_ACTION_VERIFY, 0x22, NULL);
  check_match (self, FPI_DEVICE_ACTION_IDENTIFY, 0x11, first);
  check_match (self, FPI_DEVICE_ACTION_VERIFY, 0x11, first);
  FpPrint *second = make_print (self, 0x22);
  g_ptr_array_add (candidates, second);
  check_match (self, FPI_DEVICE_ACTION_IDENTIFY, 0x22, second);
  check_match (self, FPI_DEVICE_ACTION_IDENTIFY, 0x33, NULL);
  g_ptr_array_unref (candidates);
}

static void
test_reenroll_hidden_template (void)
{
  g_autoptr(FpiDeviceFpcMoc) self = g_object_new (fpi_device_fpcmoc_get_type (), NULL);
  g_autoptr(FpPrint) expected = NULL;
  FPC_IDENTIFY response = {0};
  self->is_9924 = TRUE;
  expected = make_print (self, 0x22);
  enrollment = fp_print_new (FP_DEVICE (self));
  fp_print_set_finger (enrollment, FP_FINGER_RIGHT_INDEX);
  fp_print_set_username (enrollment, "test-user");
  response.subfactor = FPC_SUBTYPE_RESERVED;
  response.identity_type = 2;
  response.identity_size = 16;
  memset (response.data, 0x22, 16);
  jumped_to = -1;
  fpc_enroll_check_duplicate_cb (self, &response, NULL);
  /* Already persisted templates must not STORE_DB again: firmware returns -13. */
  g_assert_cmpint (jumped_to, ==, FPC_ENROLL_REFRESH_ENUM);
  g_assert_true (fp_print_equal (enrollment, expected));
  /* Enumeration also contains another template; it must not replace this one. */
  fpc_cmd_response_t listing = {0};
  listing.evt_hdr.cmdid = FPC_EVT_FID_DATA;
  listing.evt_enum_fids.num_ids = 1;
  listing.evt_enum_fids.fid_data[0].subfactor = FPC_SUBTYPE_RESERVED;
  listing.evt_enum_fids.fid_data[0].identity_type = 4;
  listing.evt_enum_fids.fid_data[0].identity_size = 32;
  memset (listing.evt_enum_fids.fid_data[0].identity, 0x33, 32);
  fpc_enroll_refresh_cb (self, &listing, NULL);
  g_assert_true (fp_print_equal (enrollment, expected));
  g_assert_cmpint (fp_print_get_finger (enrollment), ==, FP_FINGER_RIGHT_INDEX);
  g_assert_cmpstr (fp_print_get_username (enrollment), ==, "test-user");
  g_clear_object (&enrollment);
}

static void
test_refresh_exact_binding (void)
{
  g_autoptr(FpiDeviceFpcMoc) self = g_object_new (fpi_device_fpcmoc_get_type (), NULL);
  g_autoptr(FpPrint) expected = NULL;
  fpc_cmd_response_t listing = {0};
  self->is_9924 = TRUE;
  self->pending_enroll_identity_valid = TRUE;
  memset (self->pending_enroll_identity, 0x22, 16);
  expected = make_print (self, 0x22);
  /* BINDID has already initialized the print type. Refresh must not reset it. */
  enrollment = make_print (self, 0x22);
  listing.evt_hdr.cmdid = FPC_EVT_FID_DATA;
  listing.evt_enum_fids.num_ids = 2;
  listing.evt_enum_fids.fid_data[0].subfactor = FPC_SUBTYPE_RESERVED;
  listing.evt_enum_fids.fid_data[0].identity_type = 4;
  listing.evt_enum_fids.fid_data[0].identity_size = 32;
  memset (listing.evt_enum_fids.fid_data[0].identity, 0x33, 32);
  listing.evt_enum_fids.fid_data[1].subfactor = FPC_SUBTYPE_RESERVED;
  listing.evt_enum_fids.fid_data[1].identity_type = 2;
  listing.evt_enum_fids.fid_data[1].identity_size = 16;
  memset (listing.evt_enum_fids.fid_data[1].identity, 0x22, 16);
  fpc_enroll_refresh_cb (self, &listing, NULL);
  g_assert_true (fp_print_equal (enrollment, expected));
  g_clear_object (&enrollment);
}

int main (int argc, char **argv)
{
  g_test_init (&argc, &argv, NULL);
  /* Existing driver diagnostics are warnings; assertions still abort. */
  g_log_set_always_fatal (G_LOG_FATAL_MASK | G_LOG_LEVEL_CRITICAL);
  g_test_add_func ("/fpcmoc/identity/single-candidate", test_single_candidate);
  g_test_add_func ("/fpcmoc/identity/reenroll-hidden-template", test_reenroll_hidden_template);
  g_test_add_func ("/fpcmoc/identity/refresh-exact-binding", test_refresh_exact_binding);
  return g_test_run ();
}
