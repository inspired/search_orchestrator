/* "Start a new job": a card per template. Shown in place of the tabs until one is chosen. */
import React from 'react';
import Card from '@splunk/react-ui/Card';
import CardLayout from '@splunk/react-ui/CardLayout';
import Heading from '@splunk/react-ui/Heading';
import { JOB_TEMPLATES, JobTemplate } from './templates';

export interface TemplatePickerProps {
    onChoose: (template: JobTemplate) => void;
}

export default function TemplatePicker({ onChoose }: TemplatePickerProps) {
    return (
        <section aria-labelledby="template-picker-title">
            <Heading level={2} id="template-picker-title">
                Start a new job
            </Heading>
            <CardLayout>
                {JOB_TEMPLATES.map((t) => (
                    <Card key={t.key} onClick={() => onChoose(t)} style={{ cursor: 'pointer' }}>
                        <Card.Header title={t.title} subtitle={t.description} />
                    </Card>
                ))}
            </CardLayout>
        </section>
    );
}
