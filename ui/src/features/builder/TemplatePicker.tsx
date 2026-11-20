/* "Start a new job": a card per template. Shown in place of the tabs until one is chosen. */
import React from 'react';
import Card from '@splunk/react-ui/Card';
import CardLayout from '@splunk/react-ui/CardLayout';
import Heading from '@splunk/react-ui/Heading';
import { JOB_TEMPLATES, JobTemplate } from './templates';

export interface TemplatePickerProps {
    /** Pass exactly one of onChoose or hrefFor. */
    onChoose?: (template: JobTemplate) => void;
    /** Makes each card a link instead of a button. */
    hrefFor?: (key: JobTemplate['key']) => string;
    title?: string;
}

export default function TemplatePicker({ onChoose, hrefFor, title = 'Start a new job' }: TemplatePickerProps) {
    return (
        <section aria-labelledby="template-picker-title">
            <Heading level={2} id="template-picker-title">
                {title}
            </Heading>
            <CardLayout>
                {JOB_TEMPLATES.map((t) => (
                    <Card
                        key={t.key}
                        {...(hrefFor ? { to: hrefFor(t.key) } : { onClick: () => onChoose && onChoose(t) })}
                        style={{ cursor: 'pointer' }}
                    >
                        <Card.Header title={t.title} subtitle={t.description} />
                    </Card>
                ))}
            </CardLayout>
        </section>
    );
}
