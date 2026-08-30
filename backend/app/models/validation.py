from __future__ import annotations

from pydantic import BaseModel, Field


class ValidationLicense(BaseModel):
    name: str
    identifier: str
    url: str


class ValidationDataset(BaseModel):
    title: str
    doi: str
    landing_page: str
    publisher: str
    published_date: str
    funding: str
    license: ValidationLicense
    records: int
    pseudonymous_participants: int
    source_file_id: int
    source_file_md5: str
    derived_csv_sha256: str


class BenchmarkProfile(BaseModel):
    name: str
    policy_version: str
    workload: str
    workload_points: int
    acclimatization: str
    acclimatization_points: int
    clothing_mapping: str
    solar_mapping: str
    high_risk_threshold: int
    fitted_to_dataset: bool


class CorrelationMetric(BaseModel):
    pearson_r: float = Field(ge=-1, le=1)
    spearman_rho: float = Field(ge=-1, le=1)


class InputRange(BaseModel):
    minimum: float
    maximum: float
    unit: str


class ThresholdGroup(BaseModel):
    records: int
    mean_measured_pwc_loss_percent: float


class BandMetric(BaseModel):
    band: str
    records: int
    score_minimum: int
    score_maximum: int
    mean_measured_pwc_loss_percent: float
    median_measured_pwc_loss_percent: float
    p25_measured_pwc_loss_percent: float
    p75_measured_pwc_loss_percent: float


class ValidationMetrics(BaseModel):
    outcome: str
    score_vs_measured_pwc_loss: CorrelationMetric
    environmental_points_vs_measured_pwc_loss: CorrelationMetric
    comparative_index_correlations: dict[str, CorrelationMetric]
    below_high_risk_threshold: ThresholdGroup
    at_or_above_high_risk_threshold: ThresholdGroup
    mean_loss_difference_percentage_points: float
    bands: list[BandMetric]
    input_ranges: dict[str, InputRange]


class Citation(BaseModel):
    title: str
    doi: str


class HeatShieldValidationResponse(BaseModel):
    status: str
    benchmark_type: str
    dataset: ValidationDataset
    benchmark_profile: BenchmarkProfile
    metrics: ValidationMetrics
    interpretation: str
    limitations: list[str]
    citations: list[Citation]
