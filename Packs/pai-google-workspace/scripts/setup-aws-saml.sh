#!/bin/bash
set -e

# Setup Google Workspace as AWS SAML IdP
# Usage: ./setup-aws-saml.sh <google-metadata.xml> [role-name]

METADATA_FILE="${1:-}"
ROLE_NAME="${2:-GoogleWorkspaceAdmin}"
PROVIDER_NAME="GoogleWorkspace"

if [ -z "$METADATA_FILE" ]; then
  echo "Usage: $0 <google-idp-metadata.xml> [role-name]"
  echo ""
  echo "Get the metadata XML from:"
  echo "  1. Google Admin Console -> Apps -> Web and mobile apps"
  echo "  2. Add custom SAML app -> Download IdP metadata"
  echo ""
  exit 1
fi

if [ ! -f "$METADATA_FILE" ]; then
  echo "ERROR: Metadata file not found: $METADATA_FILE"
  exit 1
fi

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"

# Check if provider already exists
if aws iam get-saml-provider --saml-provider-arn "arn:aws:iam::${ACCOUNT_ID}:saml-provider/${PROVIDER_NAME}" &>/dev/null; then
  echo "Updating existing SAML provider: $PROVIDER_NAME"
  aws iam update-saml-provider \
    --saml-provider-arn "arn:aws:iam::${ACCOUNT_ID}:saml-provider/${PROVIDER_NAME}" \
    --saml-metadata-document "file://${METADATA_FILE}"
else
  echo "Creating SAML provider: $PROVIDER_NAME"
  aws iam create-saml-provider \
    --saml-metadata-document "file://${METADATA_FILE}" \
    --name "$PROVIDER_NAME"
fi

PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:saml-provider/${PROVIDER_NAME}"
echo "Provider ARN: $PROVIDER_ARN"

# Create trust policy
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "${PROVIDER_ARN}"
    },
    "Action": "sts:AssumeRoleWithSAML",
    "Condition": {
      "StringEquals": {
        "SAML:aud": "https://signin.aws.amazon.com/saml"
      }
    }
  }]
}
EOF
)

# Check if role already exists
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
  echo "Updating existing role: $ROLE_NAME"
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "$TRUST_POLICY"
else
  echo "Creating IAM role: $ROLE_NAME"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Role for Google Workspace federated users"

  # Attach AdministratorAccess (change as needed)
  echo "Attaching AdministratorAccess policy"
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess"
fi

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Provider ARN: $PROVIDER_ARN"
echo "Role ARN:     $ROLE_ARN"
echo ""
echo "=== Google SAML App Configuration ==="
echo ""
echo "Configure these in Google Admin Console -> SAML App:"
echo ""
echo "  ACS URL:     https://signin.aws.amazon.com/saml"
echo "  Entity ID:   urn:amazon:webservices"
echo "  Name ID:     EMAIL (Primary email)"
echo ""
echo "Attribute Mapping (add custom attribute):"
echo ""
echo "  https://aws.amazon.com/SAML/Attributes/RoleSessionName"
echo "    -> Basic Information > Primary email"
echo ""
echo "  https://aws.amazon.com/SAML/Attributes/Role"
echo "    -> Set value to: ${ROLE_ARN},${PROVIDER_ARN}"
echo ""
echo "Or for group-based role assignment, create a custom attribute."
