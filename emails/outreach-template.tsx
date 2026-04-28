/**
 * Outreach email template — used by the Growth agent.
 *
 * The agent passes a markdown body; we render it inside a clean,
 * deliverability-friendly React Email shell. No images, no tracking
 * pixels — just plain text wrapped in a branded container.
 */

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactElement } from "react";

export interface OutreachEmailProps {
  recipientFirstName: string | null;
  bodyMarkdown: string;
  signatureName: string;
  signatureTitle: string;
  signatureCompany: string;
  preview: string;
}

export function OutreachEmail(props: OutreachEmailProps): ReactElement {
  const greeting = props.recipientFirstName
    ? `Hi ${props.recipientFirstName},`
    : "Hi,";

  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section>
            <Text style={textStyle}>{greeting}</Text>
            {props.bodyMarkdown
              .split(/\n{2,}/)
              .map((paragraph, i) => (
                <Text key={i} style={textStyle}>
                  {paragraph}
                </Text>
              ))}
          </Section>
          <Hr style={hrStyle} />
          <Section>
            <Text style={signatureStyle}>
              {props.signatureName}
              <br />
              {props.signatureTitle}, {props.signatureCompany}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = {
  backgroundColor: "#ffffff",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

const containerStyle = {
  margin: "0 auto",
  padding: "32px 24px",
  maxWidth: "560px",
};

const textStyle = {
  color: "#0f172a",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "0 0 16px",
};

const signatureStyle = {
  ...textStyle,
  color: "#475569",
  fontSize: "14px",
};

const hrStyle = {
  borderColor: "#e2e8f0",
  margin: "24px 0",
};

export default OutreachEmail;
