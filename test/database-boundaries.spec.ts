import fs from 'node:fs';
import path from 'node:path';

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const schema = fs.readFileSync(schemaPath, 'utf8');

function hasModel(modelName: string) {
  return new RegExp(`^model\\s+${modelName}\\b`, 'm').test(schema);
}

function modelHasWorkspaceId(modelName: string) {
  return new RegExp(`^model\\s+${modelName}\\s*\\{[\\s\\S]*?workspaceId\\s+String`, 'm').test(schema);
}

describe('database boundaries', () => {
  const sharedPlatformModels = [
    'Template',
    'Workspace',
    'User',
    'WorkspaceMember',
    'StaffBlockAssignment',
    'Invite',
    'OtpCode',
    'Subscription',
    'Plan',
    'Payment',
    'WebhookEvent',
    'AuditLog',
    'TechnicianApplication',
    'AdminUser',
    'AdminSession',
    'AdminAuditLog',
  ];

  const apartmentModels = [
    'ApartmentUnit',
    'ApartmentResident',
    'ApartmentRequest',
    'ApartmentNotice',
    'ApartmentInspection',
    'ApartmentHouseholdMember',
    'ApartmentVehicle',
    'ApartmentParcel',
    'ApartmentAmenity',
    'ApartmentAmenityBooking',
    'ApartmentVisitor',
    'ApartmentCommunityChannel',
    'ApartmentCommunityMessage',
    'ApartmentRecurringCharge',
    'ApartmentVendor',
    'ApartmentWorkOrder',
    'ApartmentWorkOrderMessage',
    'ApartmentRequestMessage',
  ];

  const estateModels = [
    'Estate',
    'EstateUnit',
    'EstateResident',
    'EstateRequest',
    'EstateNotice',
    'EstateInspection',
    'EstateHouseholdMember',
    'EstateVehicle',
    'EstateParcel',
    'EstateAmenity',
    'EstateAmenityBooking',
    'EstateVisitor',
    'EstateCommunityChannel',
    'EstateCommunityMessage',
    'EstateRecurringCharge',
    'EstateVendor',
    'EstateWorkOrder',
    'EstateWorkOrderMessage',
    'EstateRequestMessage',
    'EstateLease',
    'EstateUtilityMeter',
    'EstateUtilityReading',
    'EstateViolation',
    'EstateApprovalRequest',
    'EstateInspectionTemplate',
    'EstateEmergencyAlert',
    'EstateReminderLog',
    'EstateCharge',
    'EstateChargePayment',
  ];

  const officeModels = [
    'OfficeArea',
    'OfficeRequest',
    'OfficeRequestType',
    'OfficeRequestMessage',
    'OfficeAsset',
    'OfficeWorkOrder',
    'OfficeWorkOrderMessage',
    'OfficeCommunityChannel',
    'OfficeCommunityMessage',
    'OfficeNotice',
    'OfficeInspection',
    'OfficeVisitor',
  ];

  const forbiddenGenericModels = [
    'Unit',
    'Resident',
    'Request',
    'Notice',
    'Inspection',
    'HouseholdMember',
    'Vehicle',
    'Parcel',
    'Amenity',
    'AmenityBooking',
    'Visitor',
    'RecurringCharge',
    'Vendor',
    'WorkOrder',
    'WorkOrderMessage',
    'RequestMessage',
    'Charge',
    'ChargePayment',
    'Lease',
    'UtilityMeter',
    'UtilityReading',
    'Violation',
    'ApprovalRequest',
    'InspectionTemplate',
    'EmergencyAlert',
    'ReminderLog',
  ];

  it('keeps shared platform tables centralized', () => {
    for (const model of sharedPlatformModels) {
      expect(hasModel(model)).toBe(true);
    }
  });

  it('keeps apartment domain tables namespaced and workspace-bound', () => {
    for (const model of apartmentModels) {
      expect(hasModel(model)).toBe(true);
      if (model !== 'Apartment') {
        expect(modelHasWorkspaceId(model)).toBe(true);
      }
    }
  });

  it('keeps estate domain tables namespaced and workspace-bound', () => {
    for (const model of estateModels) {
      expect(hasModel(model)).toBe(true);
      if (model !== 'Estate') {
        expect(modelHasWorkspaceId(model)).toBe(true);
      }
    }
  });

  it('keeps office domain tables namespaced and workspace-bound', () => {
    for (const model of officeModels) {
      expect(hasModel(model)).toBe(true);
      expect(modelHasWorkspaceId(model)).toBe(true);
    }
  });

  it('does not reintroduce generic shared template tables', () => {
    for (const model of forbiddenGenericModels) {
      expect(hasModel(model)).toBe(false);
    }
  });

  it('keeps workspace as the tenant boundary', () => {
    expect(schema).toMatch(/model\s+Workspace\s*\{[\s\S]*?templateType\s+TemplateType/s);
    expect(schema).toMatch(/model\s+Workspace\s*\{[\s\S]*?templateId\s+String\?/s);
    expect(schema).toMatch(/model\s+Workspace\s*\{[\s\S]*?members\s+WorkspaceMember\[\]/s);
  });
});
